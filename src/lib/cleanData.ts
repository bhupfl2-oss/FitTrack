export function cleanData(obj: any): any {
  if (Array.isArray(obj)) return obj.map(cleanData);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, v === undefined ? null : cleanData(v)])
    );
  }
  return obj === undefined ? null : obj;
}
