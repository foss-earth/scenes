import { isRecord } from "@foss-earth/images";

export interface RepresentationSchemaReference { projection: string; schemaRef: string }
export interface ExtensionSchemaReference { name: string; schemaRef: string }
/** Host tooling composes owner schema references; this package owns no format catalogue. */
export function composeSceneSchema(baseSchema: unknown, options: { representations: readonly RepresentationSchemaReference[]; extensions?: readonly ExtensionSchemaReference[] }): Record<string, unknown> {
  if (!isRecord(baseSchema)) throw new Error("A scene envelope schema object is required.");
  const copy = JSON.parse(JSON.stringify(baseSchema)) as Record<string, unknown>;
  const definitions = copy.$defs, properties = copy.properties;
  if (!isRecord(definitions) || !isRecord(definitions.representation) || !isRecord(properties)) throw new Error("Expected the exported v1 envelope schema.");
  const projections = new Set<string>();
  definitions.representation.allOf = options.representations.map(entry => {
    if (!entry.projection || projections.has(entry.projection) || typeof entry.schemaRef !== "string" || !entry.schemaRef) throw new Error("Schema registrations require unique projections and owner references.");
    projections.add(entry.projection);
    return { if: { required: ["projection"], properties: { projection: { const: entry.projection } } }, then: { $ref: entry.schemaRef } };
  });
  const extensions = new Map<string, { $ref: string }>();
  for (const entry of options.extensions ?? []) {
    if (!/^[a-z0-9-]+(\.[A-Za-z0-9_-]+)+$/.test(entry.name) || extensions.has(entry.name) || typeof entry.schemaRef !== "string" || !entry.schemaRef) throw new Error("Schema extension registrations require unique namespaced names and owner references.");
    extensions.set(entry.name, { $ref: entry.schemaRef });
  }
  if (extensions.size) properties.extensions = { $ref: "#/$defs/extensions", type: "object", properties: Object.fromEntries(extensions) };
  return copy;
}
