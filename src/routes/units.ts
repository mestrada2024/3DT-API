
import { FastifyInstance } from "fastify";

import {
  syncUnitsFromTracking3D,
  pushPlateToTracking3D,
  createUnitAndReplicate,
  deleteUnitLocal,
  assignTrackerToUnitAndReplicate,
  unassignTrackerFromUnitAndReplicate,
  UnitValidationError,
} from "../services/units-sync.service";

import { getUnitTripsForDate } from "../services/unit-trips.service";

import { getAllowedCompanyUids, requireWrite } from "../services/access-control.service";

import {
  logAction,
  getActorFromRequest,
} from "../services/audit-log.service";

import { parseSort } from "../utils/sort";

const UNIT_SORTABLE_FIELDS = [
  "name",
  "status",
  "plate",
  "companyName",
  "lastPositionAt",
  "batteryLevel",
  "speed",
  "createdAt"
] as const;

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
  sortBy?: string;
  sortDir?: string;
}

interface CreateUnitBody {
  companyUid?: string;
  name?: string;
  groupName?: string;
  unitFunction?: string;
  trackerUid?: string;
}

interface AssignTrackerBody {
  trackerUid?: string;
  imei?: string;
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
          companyUid?: { in: string[] };
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
         * root ve todas las unidades; admin/user solo las de sus
         * empresas asignadas (UserCompany) — con cero empresas
         * asignadas, ven cero unidades.
         */
        const allowedCompanyUids = await getAllowedCompanyUids(
          fastify.prisma,
          request.user.sub,
          request.user.role
        );

        if (allowedCompanyUids !== null) {
          where.companyUid = { in: allowedCompanyUids };
        }

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

        const { field: sortField, direction: sortDirection } = parseSort(
          request.query.sortBy,
          request.query.sortDir,
          UNIT_SORTABLE_FIELDS,
          "name"
        );

        const [units, total] =
          await Promise.all([
            fastify.prisma.unit.findMany({
              where,
              skip,
              take: limit,
              orderBy: {
                [sortField]: sortDirection,
              },
            }),

            fastify.prisma.unit.count({
              where,
            }),
          ]);

        /**
         * Unit.trackerUid guarda el Tracker.uid (no el nombre) — se
         * busca el nombre de los trackers referenciados en esta
         * página para que el frontend pueda mostrar el nombre del GPS
         * en vez de su UID.
         */
        const trackerUids = [...new Set(
          units
            .map((unit) => unit.trackerUid)
            .filter((uid): uid is string => Boolean(uid))
        )];

        const trackers = trackerUids.length
          ? await fastify.prisma.tracker.findMany({
              where: { uid: { in: trackerUids } },
              select: { uid: true, name: true }
            })
          : [];

        const trackerNameByUid = new Map(
          trackers.map((tracker) => [tracker.uid, tracker.name])
        );

        const unitsWithTrackerName = units.map((unit) => ({
          ...unit,
          trackerName: unit.trackerUid
            ? trackerNameByUid.get(unit.trackerUid) || null
            : null
        }));

        return reply.send({
          success: true,

          data: unitsWithTrackerName,

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
   * POST /api/v1/units
   *
   * Crea una unidad. A diferencia de SIMs/trackers, aquí se llama
   * primero a 3Dtracking (company/{companyUid}/unitcreate) y solo si
   * responde bien se guarda localmente — Unit.externalId no admite
   * null, y una unidad sin contraparte real en 3Dtracking no tiene
   * mucho sentido. Si 3Dtracking falla, no queda nada creado ni local
   * ni remoto.
   */
  fastify.post<{
    Body: CreateUnitBody;
  }>(
    "/",
    {
      preHandler: [fastify.authenticate, requireWrite],
    },
    async (request, reply) => {

      const companyUid = request.body?.companyUid?.trim();
      const name = request.body?.name?.trim();

      if (!companyUid) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_BODY",
          message: "El campo companyUid es requerido (ver GET /api/v1/tracking/companies)",
        });
      }

      if (!name) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_BODY",
          message: "El campo name es requerido",
        });
      }

      const allowedCompanyUids = await getAllowedCompanyUids(
        fastify.prisma,
        request.user.sub,
        request.user.role
      );

      if (allowedCompanyUids !== null && !allowedCompanyUids.includes(companyUid)) {
        return reply.status(403).send({
          success: false,
          error: "FORBIDDEN",
          message: "No tienes acceso a esa empresa",
        });
      }

      const actor = getActorFromRequest(request);

      try {
        const unit = await createUnitAndReplicate(
          fastify.prisma,
          fastify.tracking3d,
          companyUid,
          {
            name,
            groupName: request.body.groupName,
            unitFunction: request.body.unitFunction,
            trackerUid: request.body.trackerUid,
          }
        );

        await logAction(fastify.prisma, {
          ...actor,
          module: "units",
          action: "create",
          resource: unit.externalId,
          success: true,
          requestBody: request.body,
          afterState: unit,
        });

        return reply.status(201).send({
          success: true,
          data: unit,
        });

      } catch (error) {
        fastify.log.error(error);

        const message = error instanceof Error ? error.message : "Error desconocido";

        await logAction(fastify.prisma, {
          ...actor,
          module: "units",
          action: "create",
          resource: name,
          success: false,
          message,
          requestBody: request.body,
        });

        return reply.status(502).send({
          success: false,
          error: "TRACKING3D_ERROR",
          message: `No se pudo crear la unidad en 3Dtracking: ${message}`,
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
      preHandler: [fastify.authenticate, requireWrite],
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

        await logAction(fastify.prisma, {
          ...getActorFromRequest(request),
          module: "units",
          action: "update-plate",
          resource: identifier,
          success: tracking3d.synced,
          message: tracking3d.synced
            ? undefined
            : `Placa actualizada local; falló replicación en 3Dtracking: ${tracking3d.message}`,
          requestBody: request.body,
          beforeState: unit,
          afterState: updated,
        });

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
   * DELETE /api/v1/units/:id
   *
   * Borrado físico. 3Dtracking no tiene ningún endpoint para eliminar
   * unidades, así que esto es puramente local — el registro completo
   * (beforeState) queda solo en el log de auditoría, como respaldo.
   * Nota: borra en cascada su historial de posiciones (tabla
   * Position). :id acepta imei, plate, externalId o name (igual que
   * GET /:id).
   */
  fastify.delete<{
    Params: UnitParams;
  }>(
    "/:id",
    {
      preHandler: [fastify.authenticate, requireWrite],
    },
    async (request, reply) => {

      const identifier = request.params.id.trim();

      if (!identifier) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_IDENTIFIER",
          message: "El identificador de la unidad no es válido",
        });
      }

      const actor = getActorFromRequest(request);

      try {
        const result = await deleteUnitLocal(fastify.prisma, identifier);

        if (!result) {
          return reply.status(404).send({
            success: false,
            error: "UNIT_NOT_FOUND",
            message: "Unidad no encontrada",
          });
        }

        await logAction(fastify.prisma, {
          ...actor,
          module: "units",
          action: "delete",
          resource: identifier,
          success: true,
          beforeState: result.before,
        });

        return reply.send({
          success: true,
          data: { ...result.before, deleted: true },
          tracking3d: {
            synced: false,
            message: "3Dtracking no tiene un endpoint para eliminar unidades; el borrado es solo local",
          },
        });

      } catch (error) {
        fastify.log.error(error);

        await logAction(fastify.prisma, {
          ...actor,
          module: "units",
          action: "delete",
          resource: identifier,
          success: false,
          message: error instanceof Error ? error.message : "Error desconocido",
        });

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error eliminando la unidad",
        });
      }
    }
  );


  /**
   * POST /api/v1/units/:id/tracker
   *
   * Asigna un tracker a una unidad. El tracker se identifica por
   * trackerUid o imei en el body, y debe ya tener uid (haberse creado
   * en 3Dtracking). Actualiza local siempre primero
   * (Unit.trackerUid/imei/trackingId tomados del tracker, y de forma
   * bidireccional Tracker.unitUid); intenta replicar con
   * units/assigntracker.
   */
  fastify.post<{
    Params: UnitParams;
    Body: AssignTrackerBody;
  }>(
    "/:id/tracker",
    {
      preHandler: [fastify.authenticate, requireWrite],
    },
    async (request, reply) => {

      const identifier = request.params.id.trim();
      const trackerIdentifier = (request.body?.trackerUid || request.body?.imei || "").trim();

      if (!identifier) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_IDENTIFIER",
          message: "El identificador de la unidad no es válido",
        });
      }

      if (!trackerIdentifier) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_BODY",
          message: "Se requiere trackerUid o imei",
        });
      }

      const actor = getActorFromRequest(request);

      try {
        const result = await assignTrackerToUnitAndReplicate(
          fastify.prisma,
          fastify.tracking3d,
          identifier,
          trackerIdentifier
        );

        if (!result) {
          return reply.status(404).send({
            success: false,
            error: "UNIT_NOT_FOUND",
            message: "Unidad no encontrada",
          });
        }

        await logAction(fastify.prisma, {
          ...actor,
          module: "units",
          action: "assign-tracker",
          resource: identifier,
          success: true,
          message: result.replication.synced
            ? undefined
            : `Asignado local; falló replicación en 3Dtracking: ${result.replication.message}`,
          requestBody: request.body,
          beforeState: result.before,
          afterState: result.unit,
        });

        return reply.send({
          success: true,
          data: result.unit,
          tracker: result.tracker,
          tracking3d: result.replication,
        });

      } catch (error) {

        if (error instanceof UnitValidationError) {

          await logAction(fastify.prisma, {
            ...actor,
            module: "units",
            action: "assign-tracker",
            resource: identifier,
            success: false,
            message: error.message,
            requestBody: request.body,
          });

          return reply.status(400).send({
            success: false,
            error: "INVALID_BODY",
            message: error.message,
          });
        }

        fastify.log.error(error);

        await logAction(fastify.prisma, {
          ...actor,
          module: "units",
          action: "assign-tracker",
          resource: identifier,
          success: false,
          message: error instanceof Error ? error.message : "Error desconocido",
          requestBody: request.body,
        });

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error asignando el tracker",
        });
      }
    }
  );


  /**
   * DELETE /api/v1/units/:id/tracker
   *
   * Quita el tracker asignado a una unidad. Actualiza local siempre
   * primero (Unit.trackerUid/imei/trackingId a null y, de forma
   * bidireccional, el Tracker.unitUid correspondiente a null);
   * intenta replicar con units/unassigntracker.
   */
  fastify.delete<{
    Params: UnitParams;
  }>(
    "/:id/tracker",
    {
      preHandler: [fastify.authenticate, requireWrite],
    },
    async (request, reply) => {

      const identifier = request.params.id.trim();

      if (!identifier) {
        return reply.status(400).send({
          success: false,
          error: "INVALID_IDENTIFIER",
          message: "El identificador de la unidad no es válido",
        });
      }

      const actor = getActorFromRequest(request);

      try {
        const result = await unassignTrackerFromUnitAndReplicate(
          fastify.prisma,
          fastify.tracking3d,
          identifier
        );

        if (!result) {
          return reply.status(404).send({
            success: false,
            error: "UNIT_NOT_FOUND",
            message: "Unidad no encontrada",
          });
        }

        await logAction(fastify.prisma, {
          ...actor,
          module: "units",
          action: "unassign-tracker",
          resource: identifier,
          success: true,
          message: result.replication.synced
            ? undefined
            : `Desasignado local; no replicado en 3Dtracking: ${result.replication.message}`,
          beforeState: result.before,
          afterState: result.unit,
        });

        return reply.send({
          success: true,
          data: result.unit,
          tracker: result.tracker,
          tracking3d: result.replication,
        });

      } catch (error) {

        if (error instanceof UnitValidationError) {

          await logAction(fastify.prisma, {
            ...actor,
            module: "units",
            action: "unassign-tracker",
            resource: identifier,
            success: false,
            message: error.message,
          });

          return reply.status(400).send({
            success: false,
            error: "INVALID_BODY",
            message: error.message,
          });
        }

        fastify.log.error(error);

        await logAction(fastify.prisma, {
          ...actor,
          module: "units",
          action: "unassign-tracker",
          resource: identifier,
          success: false,
          message: error instanceof Error ? error.message : "Error desconocido",
        });

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error quitando el tracker",
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

  /**
   * GET /api/v1/units/:id/trips
   *
   * Viajes/recorridos del día para una unidad — no es un endpoint de
   * 3Dtracking, se calcula agrupando su historial de posiciones del
   * día (Data/PositionsList) en tramos de movimiento continuo
   * separados por paradas (ver services/unit-trips.service.ts). Puede
   * tardar unos segundos (pagina el stream de posiciones hasta
   * alcanzar la fecha pedida).
   *
   * Parámetros:
   * ?date=YYYY-MM-DD (default: hoy)
   */
  fastify.get<{
    Params: UnitParams;
    Querystring: { date?: string };
  }>(
    "/:id/trips",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {

      try {
        const identifier = request.params.id.trim();

        const unit = await fastify.prisma.unit.findFirst({
          where: {
            OR: [
              { externalId: identifier },
              { imei: identifier },
            ],
          },
        });

        if (!unit) {
          return reply.status(404).send({
            success: false,
            error: "UNIT_NOT_FOUND",
            message: "No existe una unidad con ese identificador",
          });
        }

        const dateParam = request.query.date?.trim();
        const date =
          dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
            ? dateParam
            : new Date().toISOString().slice(0, 10);

        const result = await getUnitTripsForDate(
          fastify.prisma,
          fastify.tracking3d,
          unit.externalId,
          date
        );

        return reply.send({
          success: true,
          data: {
            unit: {
              externalId: unit.externalId,
              name: unit.name,
            },
            ...result,
          },
        });

      } catch (error) {
        fastify.log.error(error);

        const isRateLimit =
          error instanceof Error && error.message.includes("Rate limit");

        return reply.status(502).send({
          success: false,
          error: isRateLimit ? "TRACKING3D_RATE_LIMIT" : "TRACKING3D_ERROR",
          message: isRateLimit
            ? "3Dtracking está limitando las solicitudes en este momento — intenta de nuevo en unos minutos"
            : "No se pudieron obtener los viajes de la unidad",
        });
      }
    }
  );
}
