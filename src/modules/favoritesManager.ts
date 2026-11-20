import { PRESET_FAVORITE_TOOL_IDS, TOOL_BY_ID } from './drawingCatalogue';
import {
  loadFavorites,
  loadFavoritesBarPosition,
  loadShowFavoritesBar,
  saveFavorites,
  saveFavoritesBarPosition,
  saveShowFavoritesBar,
} from './drawingStorage';

export interface FavoritesState {
  ids: string[];
  showOnChart: boolean;
  position: { x: number; y: number } | null;
}

export function initFavoritesState(): FavoritesState {
  const loaded = loadFavorites().filter((id) => Boolean(TOOL_BY_ID[id]));
  return {
    ids: loaded.length > 0 ? loaded : [...PRESET_FAVORITE_TOOL_IDS],
    showOnChart: loadShowFavoritesBar(),
    position: loadFavoritesBarPosition(),
  };
}

export function toggleFavoriteTool(currentIds: string[], toolId: string): string[] {
  if (!TOOL_BY_ID[toolId]) return currentIds;
  const exists = currentIds.includes(toolId);
  const next = exists ? currentIds.filter((id) => id !== toolId) : [...currentIds, toolId];
  saveFavorites(next);
  return next;
}

export function setShowFavoritesBar(show: boolean): boolean {
  saveShowFavoritesBar(show);
  return show;
}

export function setFavoritesBarPosition(pos: { x: number; y: number }): { x: number; y: number } {
  saveFavoritesBarPosition(pos);
  return pos;
}

export function resetPresetFavorites(): string[] {
  const presets = [...PRESET_FAVORITE_TOOL_IDS];
  saveFavorites(presets);
  return presets;
}
