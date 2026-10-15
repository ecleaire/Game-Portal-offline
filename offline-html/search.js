const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
export function searchGames(games, options = {}) {
  const words = normalized(options.query).trim().split(/\s+/).filter(Boolean), tags = [...(options.tags || [])];
  const scope = options.scope || 'all';
  const matches = games.filter(game => {
    if (options.kind && game.kind !== options.kind) return false;
    if (options.environment && game.developmentEnvironment !== options.environment) return false;
    if (tags.length && !(options.tagMatch === 'any' ? tags.some(tag => game.tags.includes(tag)) : tags.every(tag => game.tags.includes(tag)))) return false;
    const fields = {title:game.title,tags:game.tags.join(' '),environment:game.developmentEnvironment,description:(game.description || '')+' '+(game.instructions || '')};
    const text = normalized(scope === 'all' ? Object.values(fields).join(' ') : fields[scope]);
    return words.every(word => text.includes(word));
  });
  const title = (a,b) => a.title.localeCompare(b.title, 'ja') || a.path.localeCompare(b.path, 'ja');
  return matches.sort((a,b) => options.sort === 'name-desc' ? -title(a,b) : options.sort === 'updated' ? (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || title(a,b) : title(a,b));
}
