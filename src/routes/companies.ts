import {
  FastifyPluginAsync
} from "fastify";

/**
 * Solo lectura, en vivo: lista las compañías de la cuenta
 * (company/list), necesarias para el companyUid que exige
 * POST /api/v1/units. No hay tabla local — son ~24 compañías,
 * un catálogo pequeño y estable, no justifica un sync.
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

  };

export default companyRoutes;
