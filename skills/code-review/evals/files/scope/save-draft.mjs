export function saveDraft(store, actor, id, body) {
  if (!actor) throw new Error('Unauthenticated');
  const current = store.get(id);
  store.set(id, { ...current, body });
  return { ok: true };
}
