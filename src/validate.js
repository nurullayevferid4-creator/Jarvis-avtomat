// Kiçik sxem yoxlayıcı (kənar paket yoxdur).
// JSON Schema-nın sadə alt çoxluğunu başa düşür:
// type (string|number|integer|boolean|object|array|null), properties, required,
// additionalProperties:false, enum, items, minLength, maxLength, minimum, maximum, minItems, maxItems.

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(type, v) {
  if (type === "integer") return Number.isInteger(v);
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  return typeOf(v) === type;
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function check(schema, v, path, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.type && !matchesType(schema.type, v)) {
    errors.push(path + ": " + schema.type + " gözlənilirdi, " + typeOf(v) + " gəldi");
    return;
  }
  if (schema.enum && !schema.enum.includes(v)) {
    errors.push(path + ": icazə verilən dəyərlərdən biri deyil");
    return;
  }

  if (typeof v === "string") {
    if (schema.minLength !== undefined && v.length < schema.minLength) errors.push(path + ": çox qısadır");
    if (schema.maxLength !== undefined && v.length > schema.maxLength) errors.push(path + ": çox uzundur");
  }

  if (typeof v === "number") {
    if (schema.minimum !== undefined && v < schema.minimum) errors.push(path + ": çox kiçikdir");
    if (schema.maximum !== undefined && v > schema.maximum) errors.push(path + ": çox böyükdür");
  }

  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) errors.push(path + ": çox az element var");
    if (schema.maxItems !== undefined && v.length > schema.maxItems) errors.push(path + ": çox element var");
    if (schema.items) v.forEach((item, i) => check(schema.items, item, path + "[" + i + "]", errors));
  }

  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of schema.required || []) {
      if (!has(v, k)) errors.push(path + "." + k + ": məcburidir");
    }
    const props = schema.properties || {};
    for (const k of Object.keys(v)) {
      if (has(props, k)) check(props[k], v[k], path + "." + k, errors);
      else if (schema.additionalProperties === false) errors.push(path + "." + k + ": gözlənilməyən sahə");
    }
  }
}

// Qaytarır: { ok, errors }
export function validate(schema, value) {
  const errors = [];
  check(schema, value, "$", errors);
  return { ok: errors.length === 0, errors };
}
