import { createAction, props } from '@ngrx/store';
import {
  CellValue,
  FilterGroup,
  QueryResult,
  SaveBatchResult,
  SavedView,
  SortState,
  TableRow,
} from '../types/table.models';

export const loadPage = createAction('[Order Table] Load Page', props<{ refresh?: boolean }>());
export const loadPageSuccess = createAction(
  '[Order Table] Load Page Success',
  props<{ result: QueryResult; queryVersion: number }>(),
);
export const loadPageFailure = createAction(
  '[Order Table] Load Page Failure',
  props<{ error: string; queryVersion: number }>(),
);
export const setPage = createAction('[Order Table] Set Page', props<{ page: number }>());
export const setPageSize = createAction('[Order Table] Set Page Size', props<{ pageSize: number }>());
export const setSort = createAction('[Order Table] Set Sort', props<{ sort: SortState | null }>());
export const setFilter = createAction('[Order Table] Set Filter', props<{ filter: FilterGroup }>());
export const setSearch = createAction('[Order Table] Set Search', props<{ search: string }>());
export const setGroupBy = createAction('[Order Table] Set Group By', props<{ groupBy: keyof TableRow | null }>());
export const toggleTreeMode = createAction('[Order Table] Toggle Tree Mode');
export const toggleExpanded = createAction('[Order Table] Toggle Expanded', props<{ id: string }>());
export const setSelection = createAction('[Order Table] Set Selection', props<{ ids: string[] }>());
export const toggleColumn = createAction('[Order Table] Toggle Column', props<{ key: keyof TableRow }>());
export const resizeColumn = createAction(
  '[Order Table] Resize Column',
  props<{ key: keyof TableRow; width: number }>(),
);
export const togglePinned = createAction('[Order Table] Toggle Pinned', props<{ key: keyof TableRow }>());
export const setDensity = createAction(
  '[Order Table] Set Density',
  props<{ density: 'compact' | 'standard' | 'comfortable' }>(),
);
export const updateCell = createAction(
  '[Order Table] Update Cell',
  props<{ id: string; key: keyof TableRow; value: CellValue }>(),
);
export const saveDirtyCells = createAction('[Order Table] Save Dirty Cells');
export const saveDirtyCellsSuccess = createAction(
  '[Order Table] Save Dirty Cells Success',
  props<{ result: SaveBatchResult }>(),
);
export const saveDirtyCellsFailure = createAction(
  '[Order Table] Save Dirty Cells Failure',
  props<{ error: string }>(),
);
export const retryConflict = createAction(
  '[Order Table] Retry Conflict',
  props<{ id: string; key: keyof TableRow }>(),
);
export const discardConflict = createAction(
  '[Order Table] Discard Conflict',
  props<{ id: string; key: keyof TableRow }>(),
);
export const discardDirtyCells = createAction('[Order Table] Discard Dirty Cells');
export const externalDataChanged = createAction(
  '[Order Table] External Data Changed',
  props<{ dataVersion: number; cellVersions: Record<string, number> }>(),
);
export const saveView = createAction('[Order Table] Save View', props<{ name: string }>());
export const applyView = createAction('[Order Table] Apply View', props<{ view: SavedView }>());
export const deleteView = createAction('[Order Table] Delete View', props<{ id: string }>());
