// Ignore handle object identity: each scan returns fresh browser handles.
export function libraryViewKey(games) {
  return JSON.stringify(games.map(({handle,folder,...game})=>game));
}
// Reuse the visible card even when a save receipt, timestamp or content release
// changes. Click handlers resolve the latest game and fresh file handles.
export function cardViewKey(game) {
  return JSON.stringify([game.id,game.path,game.kind,game.title,game.tags,game.developmentEnvironment,game.description?.slice(0,100),game.description?.length>100,game.thumbnail,game.settingsError,game.thumbnail===true?game.updatedAt:null]);
}
