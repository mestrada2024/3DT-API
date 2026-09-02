
import { FastifyInstance } from "fastify";

import {
  syncUnitsFromTracking3D,
  pushPlateToTracking3D,
} from "../services/units-sync.service";

interface UnitParams {
  id: string;
}

interface ImeiParams {
  imei: string;
}

interface UpdatePlateBody {
  plate?: string | null;
}

interface UnitQuery {
  page?: string;
  limit?: string;
  active?: string;
  search?: string;
  hasPlate?: string;
}

export default async function unitsRoutes(
  fastify: FastifyInstance
) {

  /**
   * GET /api/v1/units
   *
   * Lista las unidades registradas.
   *
   * Parámetros:
   * ?page=1
   * ?limit=20
   * ?active=true
   * ?search=ABC
   * ?hasPlate=true
   */
  fastify.get<{
    Querystring: UnitQuery;
  }>(
    "/",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {

      try {
        const page = Math.max(
          parseInt(request.query.page || "1", 10),
          1
        );

        const limit = Math.min(
          Math.max(
            parseInt(request.query.limit || "20", 10),
            1
          ),
          100
        );

        const skip = (page - 1) * limit;

        const where: {
          active?: boolean;
          plate?: {
            not: null;
          };
          OR?: Array<{
            name?: {
              contains: string;
            };
            plate?: {
              contains: string;
            };
            imei?: {
              contains: string;
            };
          }>;
        } = {};

        /**
         * Filtrar por estado
         */
        if (request.query.active !== undefined) {
          where.active =
            request.query.active === "true";
        }

        /**
         * Filtrar por unidades que tienen placa asignada
         */
        if (request.query.hasPlate === "true") {
          where.plate = {
            not: null,
          };
        }

        /**
         * Buscar por nombre, placa o IMEI
         */
        if (request.query.search) {
          const search = request.query.search.trim();

          if (search) {
            where.OR = [
              {
                name: {
                  contains: search,
                },
              },
              {
                plate: {
                  contains: search,
                },
              },
              {
                imei: {
                  contains: search,
                },
              },
            ];
          }
        }

        const [units, total] =
          await Promise.all([
            fastify.prisma.unit.findMany({
              where,
              skip,
              take: limit,
              orderBy: {
                id: "asc",
              },
            }),

            fastify.prisma.unit.count({
              where,
            }),
          ]);

        return reply.send({
          success: true,

          data: units,

          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        });

      } catch (error) {
        fastify.log.error(error);

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo unidades",
        });
      }
    }
  );


  /**
   * POST /api/v1/units/sync
   *
   * Sincroniza todas las unidades desde 3Dtracking hacia la base local
   * (incluye la placa, leída del atributo "Placa" de cada unidad).
   */
  fastify.post(
    "/sync",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {

      try {
        const result = await syncUnitsFromTracking3D(
          fastify.prisma,
          fastify.tracking3d
        );

        return reply.send({
          success: true,
          data: result,
        });

      } catch (error) {
        fastify.log.error(error);

        return reply.status(502).send({
          success: false,
          error: "TRACKING3D_SYNC_ERROR",
          message: "No se pudo sincronizar con 3Dtracking",
        });
      }
    }
  );


  /**
   * GET /api/v1/units/:id
   *
   * Busca una unidad por imei, plate, externalId o name
   * (coincidencia exacta contra cualquiera de esos campos).
   */
  fastify.get<{
    Params: UnitParams;
  }>(
    "/:id",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {

      try {
        const identifier = request.params.id.trim();

        if (!identifier) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_IDENTIFIER",
            message: "El identificador de la unidad no es válido",
          });
        }

        const unit =
          await fastify.prisma.unit.findFirst({
            where: {
              OR: [
                { imei: identifier },
                { plate: identifier },
                { externalId: identifier },
                { name: identifier },
              ],
            },
          });

        if (!unit) {
          return reply.status(404).send({
            success: false,
            error: "UNIT_NOT_FOUND",
            message: "Unidad no encontrada",
          });
        }

        return reply.send({
          success: true,
          data: unit,
        });

      } catch (error) {
        fastify.log.error(error);

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo la unidad",
        });
      }
    }
  );


  /**
   * PATCH /api/v1/units/:id/plate
   *
   * Actualiza la placa en la base local y la empuja al atributo
   * "Placa" de esa unidad en 3Dtracking. :id acepta imei, plate,
   * externalId o name (igual que GET /:id).
   */
  fastify.patch<{
    Params: UnitParams;
    Body: UpdatePlateBody;
  }>(
    "/:id/plate",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {

      try {
        const identifier = request.params.id.trim();

        if (!identifier) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_IDENTIFIER",
            message: "El identificador de la unidad no es válido",
          });
        }

        if (request.body?.plate === undefined) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_BODY",
            message: "El campo plate es requerido",
          });
        }

        const plate = request.body.plate?.trim() || null;

        const unit =
          await fastify.prisma.unit.findFirst({
            where: {
              OR: [
                { imei: identifier },
                { plate: identifier },
                { externalId: identifier },
                { name: identifier },
              ],
            },
          });

        if (!unit) {
          return reply.status(404).send({
            success: false,
            error: "UNIT_NOT_FOUND",
            message: "Unidad no encontrada",
          });
        }

        const updated =
          await fastify.prisma.unit.update({
            where: {
              id: unit.id,
            },
            data: {
              plate,
            },
          });

        let tracking3d;

        try {
          tracking3d = await pushPlateToTracking3D(
            fastify.tracking3d,
            unit.externalId,
            plate || ""
          );
        } catch (error) {
          fastify.log.error(error);
          tracking3d = {
            synced: false,
            message: "No se pudo sincronizar con 3Dtracking",
          };
        }

        return reply.send({
          success: true,
          data: updated,
          tracking3d,
        });

      } catch (error) {
        fastify.log.error(error);

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error actualizando la unidad",
        });
      }
    }
  );


  /**
   * GET /api/v1/units/imei/:imei
   *
   * Obtiene una unidad mediante su IMEI.
   */
  fastify.get<{
    Params: ImeiParams;
  }>(
    "/imei/:imei",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {

      try {
        const imei = request.params.imei.trim();

        if (!imei) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_IMEI",
            message: "IMEI requerido",
          });
        }

        const unit =
          await fastify.prisma.unit.findFirst({
            where: {
              imei,
            },
          });

        if (!unit) {
          return reply.status(404).send({
            success: false,
            error: "UNIT_NOT_FOUND",
            message: "No existe una unidad con ese IMEI",
          });
        }

        return reply.send({
          success: true,
          data: unit,
        });

      } catch (error) {
        fastify.log.error(error);

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error buscando la unidad",
        });
      }
    }
  );
}
