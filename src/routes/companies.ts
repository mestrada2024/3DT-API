import {
  FastifyPluginAsync
} from "fastify";

import {
  syncCompaniesFromTracking3D
} from "../services/company-sync.service";

interface CompaniesListQuery {
  page?: string;
  limit?: string;
  search?: string;
}

/**
 * GET /companies: en vivo, sin tabla local (compañías de la cuenta,
 * company/list) — necesarias para el companyUid que exige
 * POST /api/v1/units.
 * GET /companies/local + POST /companies/sync: tabla local, misma
 * lógica de sync que TrackerType/UnitModel/Tracker.
 */
const companyRoutes:
  FastifyPluginAsync =
  async (app) => {

    /**
     * GET
     * /api/v1/tracking/companies
     */
    app.get(
      "/companies",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const session =
            await app.tracking3d.authenticate();

          const companies =
            await app.tracking3d.getCompanyList(session);

          return {

            success: true,

            data: companies

          };

        } catch (error) {

          app.log.error(error);

          return reply
            .code(502)
            .send({

              success: false,

              error:
                "TRACKING3D_ERROR",

              message:
                "Unable to obtain companies from 3Dtracking"

            });

        }

      }
    );

    /**
     * Listar compañías locales (con búsqueda).
     *
     * GET
     * /api/v1/tracking/companies/local
     *
     * Parámetros:
     * ?page=1
     * ?limit=20
     * ?search=ABC  (busca en uid, name, country)
     */
    app.get<{
      Querystring: CompaniesListQuery;
    }>(
      "/companies/local",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
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
            OR?: Array<{
              uid?: { contains: string };
              name?: { contains: string };
              country?: { contains: string };
            }>;
          } = {};

          if (request.query.search) {
            const search = request.query.search.trim();

            if (search) {
              where.OR = [
                { uid: { contains: search } },
                { name: { contains: search } },
                { country: { contains: search } }
              ];
            }
          }

          const [companies, total] =
            await Promise.all([
              app.prisma.company.findMany({
                where,
                skip,
                take: limit,
                orderBy: { id: "asc" }
              }),

              app.prisma.company.count({
                where
              })
            ]);

          return reply.send({

            success: true,

            data: companies,

            pagination: {
              page,
              limit,
              total,
              pages: Math.ceil(total / limit)
            }

          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(500)
            .send({

              success: false,

              error:
                "INTERNAL_SERVER_ERROR",

              message:
                "Error obteniendo compañías"

            });

        }

      }
    );

    /**
     * Forzar una sincronización inmediata de compañías desde
     * 3Dtracking (company/list).
     *
     * POST
     * /api/v1/tracking/companies/sync
     */
    app.post(
      "/companies/sync",
      {
        preHandler: async (request) => {

          await request.jwtVerify();

        }
      },
      async (request, reply) => {

        try {

          const result =
            await syncCompaniesFromTracking3D(
              app.prisma,
              app.tracking3d
            );

          return reply.send({

            success: true,

            data: result

          });

        } catch (error) {

          app.log.error(error);

          return reply
            .code(502)
            .send({

              success: false,

              error:
                "TRACKING3D_SYNC_ERROR",

              message:
                "No se pudo sincronizar compañías con 3Dtracking"

            });

        }

      }
    );

  };

export default companyRoutes;
