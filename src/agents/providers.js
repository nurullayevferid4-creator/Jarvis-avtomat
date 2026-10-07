// Manager hesabatı üçün hazır provider adapterləri. Hamısı yalnız OXUYUR.

// ApprovalCenter-in özü uyğundur (list({ limit })). Bu, yalnız açıq müqavilə üçün nazik sarğıdır.
export function createApprovalProvider(approvals) {
  return { async list({ limit = 40 } = {}) { return await approvals.list({ limit }); } };
}

// Sosial iş qeydləri ("socialjob" sənədləri): id, status, updated_at. Token/məzmun çıxmır.
export function createJobProvider(store) {
  return {
    async list({ limit = 40 } = {}) {
      const docs = await store.listDocs("socialjob", limit);
      return docs.map((j) => ({ id: j.id, status: j.status, updated_at: j.updated_at || j.created_at }));
    },
  };
}

// Shopify sifarişləri (yalnız oxuma): id, status, created_at. Alıcı məlumatı çıxmır.
// Token yoxdursa client AUTH_ERROR atır; Manager bunu «qoşulmayıb» kimi göstərir.
export function createShopifyProvider(client, Q_ORDERS) {
  return {
    async list({ limit = 20 } = {}) {
      const d = await client.query(Q_ORDERS, { first: Math.min(20, Math.max(1, limit)), query: null });
      return ((d.orders && d.orders.nodes) || []).map((o) => ({ id: o.id, status: String(o.displayFinancialStatus || "unknown").toLowerCase(), created_at: o.createdAt }));
    },
  };
}
