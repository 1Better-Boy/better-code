export async function openDocument(id, fetchDocument, view) {
  view.currentId = id;
  const document = await fetchDocument(id);
  view.document = document;
  return document;
}
