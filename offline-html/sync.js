// Ignore handle object identity: each scan returns fresh browser handles.
export function libraryViewKey(games) {
  return JSON.stringify(games.map(({handle,folder,...game})=>game));
}
