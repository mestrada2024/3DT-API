import { PrismaClient, TrackerConfigTemplate, TrackerConfigAttribute } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

/**
 * Nombres de atributo confirmados contra datos reales (iguales en
 * todos los modelos de tracker de la cuenta — el AttributeId sí es
 * único por tracker, no por modelo). Se usan como default al crear
 * una plantilla sin especificar attributes.
 */
export const DEFAULT_TRACKER_CONFIG_ATTRIBUTE_NAMES = [
  "Nombre de Usuario",
  "Contraseña",
  "Puerto de Mensaje Saliente",
  "IP Enrutamiento",
  "Puerto de  Enrutamiento",
  "IP Dispositivo"
];

export class ConfigTemplateNotFoundError extends Error {}

export type TrackerConfigTemplateWithAttributes = TrackerConfigTemplate & {
  attributes: TrackerConfigAttribute[];
};

/**
 * Crea/reemplaza por completo la plantilla de configuración de un
 * modelo (unitModelUid debe existir en la tabla local UnitModel). Si
 * no se pasan attributes, se seedea con los 6 nombres conocidos y
 * valor vacío, para completarlos después.
 */
export async function upsertConfigTemplate(
  prisma: PrismaClient,
  unitModelUid: string,
  attributes?: Record<string, string | null>
): Promise<TrackerConfigTemplateWithAttributes> {

  const unitModel = await prisma.unitModel.findUnique({
    where: { uid: unitModelUid }
  });

  if (!unitModel) {
    throw new ConfigTemplateNotFoundError(
      `unitModelUid "${unitModelUid}" no existe en el catálogo local (GET /api/v1/tracking/unitmodels/local)`
    );
  }

  const entries = attributes && Object.keys(attributes).length > 0
    ? Object.entries(attributes)
    : DEFAULT_TRACKER_CONFIG_ATTRIBUTE_NAMES.map((name) => [name, null] as const);

  const template = await prisma.trackerConfigTemplate.upsert({
    where: { unitModelUid },
    create: {
      unitModelUid,
      unitModelName: unitModel.name
    },
    update: {
      unitModelName: unitModel.name
    }
  });

  await prisma.trackerConfigAttribute.deleteMany({
    where: { templateId: template.id }
  });

  await prisma.trackerConfigAttribute.createMany({
    data: entries.map(([name, value]) => ({
      templateId: template.id,
      name,
      value: value?.trim() || null
    }))
  });

  const attrs = await prisma.trackerConfigAttribute.findMany({
    where: { templateId: template.id }
  });

  return { ...template, attributes: attrs };
}

export async function getConfigTemplate(
  prisma: PrismaClient,
  unitModelUid: string
): Promise<TrackerConfigTemplateWithAttributes | null> {

  return prisma.trackerConfigTemplate.findUnique({
    where: { unitModelUid },
    include: { attributes: true }
  });
}

export interface ApplyConfigTemplateResult {
  applied: boolean;
  appliedAttributes: string[];
  skippedAttributes: string[];
  message?: string;
}

/**
 * Aplica la plantilla del modelo del tracker (si existe) a un tracker
 * real ya creado en 3Dtracking. Solo manda los atributos con un valor
 * no vacío definido en la plantilla (los que siguen en blanco se
 * omiten, no se pisan con ""). Cada atributo se resuelve por nombre
 * contra el detalle en vivo del tracker (el AttributeId es propio de
 * cada tracker, no del modelo) — un nombre de la plantilla que no
 * exista en ese tracker se reporta en skippedAttributes sin fallar el
 * resto. Nunca lanza.
 */
export async function applyConfigTemplateToTracker(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  trackerUid: string,
  unitModelUid: string | null
): Promise<ApplyConfigTemplateResult> {

  if (!unitModelUid) {
    return { applied: false, appliedAttributes: [], skippedAttributes: [], message: "El tracker no tiene unitModelUid" };
  }

  const template = await getConfigTemplate(prisma, unitModelUid);

  if (!template) {
    return { applied: false, appliedAttributes: [], skippedAttributes: [], message: "No hay plantilla de configuración para este modelo" };
  }

  const valuesToApply = template.attributes.filter(
    (attribute) => attribute.value !== null && attribute.value !== ""
  );

  if (valuesToApply.length === 0) {
    return { applied: false, appliedAttributes: [], skippedAttributes: [], message: "La plantilla existe pero no tiene valores definidos todavía" };
  }

  try {
    const session = await tracking3d.authenticate();

    const detail = await tracking3d.getTrackerDetail(session, trackerUid);

    if (!detail) {
      return { applied: false, appliedAttributes: [], skippedAttributes: [], message: "No se encontró el tracker en 3Dtracking para aplicar la plantilla" };
    }

    const appliedAttributes: string[] = [];
    const skippedAttributes: string[] = [];
    const updates: Array<{ AttributeId: number; Value: string }> = [];

    for (const templateAttribute of valuesToApply) {
      const liveAttribute = detail.Attributes.find((attribute) => attribute.Name === templateAttribute.name);

      if (!liveAttribute) {
        skippedAttributes.push(templateAttribute.name);
        continue;
      }

      updates.push({ AttributeId: liveAttribute.AttributeId, Value: templateAttribute.value as string });
      appliedAttributes.push(templateAttribute.name);
    }

    if (updates.length === 0) {
      return { applied: false, appliedAttributes: [], skippedAttributes, message: "Ninguno de los atributos de la plantilla existe en este tracker" };
    }

    await tracking3d.updateTrackerAttributes(session, trackerUid, updates);

    return { applied: true, appliedAttributes, skippedAttributes };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return { applied: false, appliedAttributes: [], skippedAttributes: [], message };
  }
}

export class TrackerConfigSourceError extends Error {}

/**
 * Lee del detalle en vivo del tracker los valores actuales de los
 * atributos configurables conocidos (DEFAULT_TRACKER_CONFIG_ATTRIBUTE_NAMES),
 * ignorando los de solo lectura y los que estén vacíos.
 */
async function readConfigurableAttributeValues(
  tracking3d: Tracking3DService,
  trackerUid: string
): Promise<Record<string, string>> {

  const session = await tracking3d.authenticate();
  const detail = await tracking3d.getTrackerDetail(session, trackerUid);

  if (!detail) {
    throw new TrackerConfigSourceError("El tracker de origen no existe en 3Dtracking");
  }

  const values: Record<string, string> = {};

  for (const name of DEFAULT_TRACKER_CONFIG_ATTRIBUTE_NAMES) {
    const attribute = detail.Attributes.find((item) => item.Name === name);

    if (attribute?.Value) {
      values[name] = attribute.Value;
    }
  }

  return values;
}

/**
 * "Copiar configuración de la unidad": toma los valores de atributos
 * configurables que YA tiene un tracker real (funcionando, ya
 * configurado manualmente en 3Dtracking) y los guarda como la
 * plantilla del modelo de ese tracker — mismo mecanismo que la opción
 * "Copiar configuración de la Unidad" del panel de 3Dtracking, pero
 * aplicado al nivel de modelo en vez de unidad por unidad. El tracker
 * de origen se identifica por uid o imei.
 */
export async function captureConfigTemplateFromTracker(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  sourceIdentifier: string
): Promise<{ template: TrackerConfigTemplateWithAttributes; sourceTrackerUid: string; capturedAttributes: string[] }> {

  const source = await prisma.tracker.findFirst({
    where: {
      active: true,
      OR: [
        { uid: sourceIdentifier },
        { imei: sourceIdentifier }
      ]
    }
  });

  if (!source) {
    throw new TrackerConfigSourceError("Tracker de origen no encontrado (o borrado lógicamente)");
  }

  if (!source.uid) {
    throw new TrackerConfigSourceError("El tracker de origen no tiene uid (aún no se ha creado en 3Dtracking)");
  }

  if (!source.unitModelUid) {
    throw new TrackerConfigSourceError("El tracker de origen no tiene unitModelUid");
  }

  const values = await readConfigurableAttributeValues(tracking3d, source.uid);

  if (Object.keys(values).length === 0) {
    throw new TrackerConfigSourceError("El tracker de origen no tiene ningún atributo configurado para copiar");
  }

  const template = await upsertConfigTemplate(prisma, source.unitModelUid, values);

  return { template, sourceTrackerUid: source.uid, capturedAttributes: Object.keys(values) };
}

/**
 * "Copiar configuración de la unidad" directo, tracker a tracker (sin
 * pasar por la plantilla): lee los atributos configurables del
 * tracker de origen y los aplica tal cual al tracker destino.
 */
export async function copyTrackerConfig(
  prisma: PrismaClient,
  tracking3d: Tracking3DService,
  sourceIdentifier: string,
  targetIdentifier: string
): Promise<{ sourceTrackerUid: string; targetTrackerUid: string; result: ApplyConfigTemplateResult }> {

  const [source, target] = await Promise.all([
    prisma.tracker.findFirst({
      where: { active: true, OR: [{ uid: sourceIdentifier }, { imei: sourceIdentifier }] }
    }),
    prisma.tracker.findFirst({
      where: { active: true, OR: [{ uid: targetIdentifier }, { imei: targetIdentifier }] }
    })
  ]);

  if (!source) {
    throw new TrackerConfigSourceError("Tracker de origen no encontrado (o borrado lógicamente)");
  }

  if (!source.uid) {
    throw new TrackerConfigSourceError("El tracker de origen no tiene uid (aún no se ha creado en 3Dtracking)");
  }

  if (!target) {
    throw new TrackerConfigSourceError("Tracker destino no encontrado (o borrado lógicamente)");
  }

  if (!target.uid) {
    throw new TrackerConfigSourceError("El tracker destino no tiene uid (aún no se ha creado en 3Dtracking)");
  }

  const values = await readConfigurableAttributeValues(tracking3d, source.uid);

  if (Object.keys(values).length === 0) {
    throw new TrackerConfigSourceError("El tracker de origen no tiene ningún atributo configurado para copiar");
  }

  try {
    const session = await tracking3d.authenticate();
    const detail = await tracking3d.getTrackerDetail(session, target.uid);

    if (!detail) {
      return {
        sourceTrackerUid: source.uid,
        targetTrackerUid: target.uid,
        result: { applied: false, appliedAttributes: [], skippedAttributes: [], message: "El tracker destino no existe en 3Dtracking" }
      };
    }

    const appliedAttributes: string[] = [];
    const skippedAttributes: string[] = [];
    const updates: Array<{ AttributeId: number; Value: string }> = [];

    for (const [name, value] of Object.entries(values)) {
      const liveAttribute = detail.Attributes.find((attribute) => attribute.Name === name);

      if (!liveAttribute) {
        skippedAttributes.push(name);
        continue;
      }

      updates.push({ AttributeId: liveAttribute.AttributeId, Value: value });
      appliedAttributes.push(name);
    }

    if (updates.length === 0) {
      return {
        sourceTrackerUid: source.uid,
        targetTrackerUid: target.uid,
        result: { applied: false, appliedAttributes: [], skippedAttributes, message: "Ninguno de los atributos del origen existe en el tracker destino" }
      };
    }

    await tracking3d.updateTrackerAttributes(session, target.uid, updates);

    return {
      sourceTrackerUid: source.uid,
      targetTrackerUid: target.uid,
      result: { applied: true, appliedAttributes, skippedAttributes }
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    return {
      sourceTrackerUid: source.uid,
      targetTrackerUid: target.uid,
      result: { applied: false, appliedAttributes: [], skippedAttributes: [], message }
    };
  }
}
