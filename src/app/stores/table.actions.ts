import { createAction, props } from '@ngrx/store';
import {
  CellValue,
  ExternalChangeResponse,
  FilterGroup,
  QueryResult,
  SaveCellsResponse,
  SavedView,
  SortState,
  TableRow,
} from '../types/table.models';

// === 查询会话 ===
export const loadPage = createAction(
  '[Order Table] Load Page',
  (props: { refresh?: boolean } = {}) => props,
);
export const loadPageSuccess = createAction(
  '[Order Table] Load Page Success',
  props<{ result: QueryResult }>(),
);
export const loadPageFailure = createAction(
  '[Order Table] Load Page Failure',
  props<{ error: string; sessionId: number; dataVersion: number }>(),
);
export const setPage = createAction('[Order Table] Set Page', props<{ page: number }>());
export const setPageSize = createAction('[Order Table] Set Page Size', props<{ pageSize: number }>());
export const setSort = createAction('[Order Table] Set Sort', props<{ sort: SortState | null }>());
export const setFilter = createAction('[Order Table] Set Filter', props<{ filter: FilterGroup }>());
export const setSearch = createAction('[Order Table] Set Search', props<{ search: string }>());
export const setGroupBy = createAction('[Order Table] Set Group By', props<{ groupBy: keyof TableRow | null }>());
export const toggleTreeMode = createAction('[Order Table] Toggle Tree Mode');
export const toggleExpanded = createAction('[Order Table] Toggle Expanded', props<{ id: string }>());

// === 选择与列状态 ===
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

// === 单元格编辑与批量保存 ===
export const updateCell = createAction(
  '[Order Table] Update Cell',
  props<{ id: string; key: keyof TableRow; value: CellValue }>(),
);
export const saveCells = createAction('[Order Table] Save Cells');
export const saveCellsSuccess = createAction(
  '[Order Table] Save Cells Success',
  props<{ response: SaveCellsResponse }>(),
);
export const saveCellsFailure = createAction(
  '[Order Table] Save Cells Failure',
  props<{ error: string }>(),
);
export const retryConflict = createAction(
  '[Order Table] Retry Conflict',
  props<{ id: string; field: keyof TableRow }>(),
);
export const retryAllConflicts = createAction('[Order Table] Retry All Conflicts');
export const discardConflict = createAction(
  '[Order Table] Discard Conflict',
  props<{ id: string; field: keyof TableRow }>(),
);
export const discardAllConflicts = createAction('[Order Table] Discard All Conflicts');
export const discardAllPending = createAction('[Order Table] Discard All Pending');

// === 模拟外部标签页变更 ===
export const simulateExternalChange = createAction('[Order Table] Simulate External Change');
export const simulateExternalChangeSuccess = createAction(
  '[Order Table] Simulate External Change Success',
  props<{ response: ExternalChangeResponse }>(),
);

// === 视图 ===
export const saveView = createAction('[Order Table] Save View', props<{ name: string }>());
export const applyView = createAction('[Order Table] Apply View', props<{ view: SavedView }>());
export const deleteView = createAction('[Order Table] Delete View', props<{ id: string }>());
