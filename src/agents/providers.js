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
