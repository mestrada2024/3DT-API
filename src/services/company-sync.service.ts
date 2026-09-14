import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

export interface CompanySyncResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
}

/**
 * Sincroniza la tabla local Company contra company/list. Upsert por
 * uid.
 */
export async function syncCompaniesFromTracking3D(
  prisma: PrismaClient,
  tracking3d: Tracking3DService
): Promise<CompanySyncResult> {

  const session = await tracking3d.authenticate();
  const companies = await tracking3d.getCompanyList(session);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const company of companies) {
    if (!company?.Uid) {
      errors++;
      continue;
    }

    try {
      const data = {
        name: company.Name || null,
        status: company.Status || null,
        serviceType: company.ServiceType || null,
        country: company.Country || null,
        currency: company.Currency || null,
        language: company.Language || null,
        timeZone: company.TimeZone || null,
        contactEmail: company.ContactEmail || null,
        contactPhone: company.ContactPhone || null,
        contactPosition: company.ContactPosition || null,
        contactName: company.ContactName || null,
        notes: company.Notes || null,
        createdDateTimeUtc: company.CreatedDateTimeUtc ? new Date(company.CreatedDateTimeUtc) : null
      };

      const result = await prisma.company.upsert({
        where: { uid: company.Uid },
        create: { uid: company.Uid, ...data },
        update: data
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }

    } catch (error) {
      console.error(`Error sincronizando compañía ${company.Uid} (${company.Name}):`, error);
      errors++;
    }
  }

  return {
    total: companies.length,
    created,
    updated,
    errors
  };
}
