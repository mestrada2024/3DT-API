
import { FastifyInstance } from "fastify";

interface UnitParams {
  id: string;
}

interface ImeiParams {
  imei: string;
}

interface UnitQuery {
  page?: string;
  limit?: string;
  active?: string;
  search?: string;
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
   * GET /api/v1/units/:id
   *
   * Obtiene una unidad por ID.
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
        const id = Number(request.params.id);

        if (!Number.isInteger(id) || id <= 0) {
          return reply.status(400).send({
            success: false,
            error: "INVALID_ID",
            message: "El ID de la unidad no es válido",
          });
        }

        const unit =
          await fastify.prisma.unit.findUnique({
            where: {
              id,
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
          await fastify.prisma.unit.findUnique({
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
