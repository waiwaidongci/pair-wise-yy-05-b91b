import { createReducer, on } from '@ngrx/store';
import {
  AggregateResult,
  FilterGroup,
  PendingChange,
  SavedView,
  SessionSnapshot,
  TableRow,
  TableState,
} from '../types/table.models';
import * as TableActions from './table.actions';

const EMPTY_AGGREGATE: AggregateResult = { amount: 0, quantity: 0, averageMargin: 0 };

export const SESSION_STORAGE_KEY = 'pair-wise-yy-05:session';

export const EMPTY_FILTER: FilterGroup = {
  kind: 'group',
  id: 'root',
  logic: 'and',
  children: [],
};

export const TABLE_COLUMNS: Array<{ key: keyof TableRow; label: string }> = [
  { key: 'orderNo', label: '订单编号' },
  { key: 'customer', label: '客户名称' },
  { key: 'region', label: '区域' },
  { key: 'category', label: '产品线' },
  { key: 'owner', label: '负责人' },
  { key: 'amount', label: '合同金额' },
  { key: 'quantity', label: '数量' },
  { key: 'margin', label: '毛利率' },
  { key: 'status', label: '状态' },
  { key: 'updatedAt', label: '更新时间' },
];

const initialVisibleColumns = TABLE_COLUMNS.map((column) => column.key);
const initialWidths = Object.fromEntries(
  TABLE_COLUMNS.map((column) => [
    column.key,
    ['orderNo', 'customer'].includes(String(column.key)) ? 190 : 132,
  ]),
);

const initialViews = readViews();
const sessionSnapshot = readSession();

export const initialState: TableState = {
  rows: [],
  total: 0,
  groups: [],
  aggregates: EMPTY_AGGREGATE,
  loading: false,
  error: null,
  page: sessionSnapshot?.page ?? 0,
  pageSize: sessionSnapshot?.pageSize ?? 100,
  sort: sessionSnapshot?.sort ?? { field: 'updatedAt', direction: 'desc' },
  filter: sessionSnapshot?.filter ?? EMPTY_FILTER,
  search: sessionSnapshot?.search ?? '',
  groupBy: sessionSnapshot?.groupBy ?? null,
  treeMode: sessionSnapshot?.treeMode ?? false,
  expandedIds: [],
  selectedIds: [],
  visibleColumns: initialVisibleColumns,
  columnWidths: initialWidths,
  pinnedColumns: ['orderNo', 'customer'],
  density: 'standard',
  elapsedMs: 0,
  savedViews: initialViews,
  activeViewId: null,
  dirtyCells: sessionSnapshot?.dirtyCells ?? {},
  conflicts: sessionSnapshot?.conflicts ?? {},
  cellVersions: sessionSnapshot?.cellVersions ?? {},
  queryVersion: 1,
  dataVersion: sessionSnapshot?.dataVersion ?? 0,
  saving: false,
  saveError: null,
  sessionRestored: !!sessionSnapshot && (
    Object.keys(sessionSnapshot.dirtyCells).length > 0 ||
    Object.keys(sessionSnapshot.conflicts).length > 0
  ),
};

/** 查询条件或数据版本变化后，作废旧结果并清空当前展示，等待新条件的数据。 */
function invalidateQuery(state: TableState): TableState {
  return {
    ...state,
    queryVersion: state.queryVersion + 1,
    rows: [],
    total: 0,
    groups: [],
    aggregates: EMPTY_AGGREGATE,
    loading: true,
    error: null,
  };
}

function cellKeyOf(id: string, key: keyof TableRow): string {
  return `${id}::${String(key)}`;
}

export const tableReducer = createReducer(
  initialState,
  on(TableActions.loadPage, (state) => invalidateQuery(state)),
  on(TableActions.loadPageSuccess, (state, { result, queryVersion }) => {
    // 过期查询（条件已变或数据版本落后）的结果直接失效，不覆盖当前会话
    if (queryVersion !== state.queryVersion || result.dataVersion < state.dataVersion) {
      return state;
    }
    const pending = Object.values(state.dirtyCells);
    return {
      ...state,
      rows: result.rows.map((row) => {
        let next = row;
        for (const change of pending) {
          if (change.id === row.id) {
            next = next === row ? { ...row, [change.key]: change.value } : { ...next, [change.key]: change.value };
          }
        }
        return next;
      }),
      total: result.total,
      groups: result.groups,
      aggregates: result.aggregates,
      loading: false,
      elapsedMs: result.elapsedMs,
      dataVersion: result.dataVersion,
      cellVersions: result.cellVersions,
    };
  }),
  on(TableActions.loadPageFailure, (state, { error, queryVersion }) => {
    if (queryVersion !== state.queryVersion) {
      return state;
    }
    return { ...state, loading: false, error };
  }),
  on(TableActions.setPage, (state, { page }) => ({ ...invalidateQuery(state), page })),
  on(TableActions.setPageSize, (state, { pageSize }) => ({ ...invalidateQuery(state), pageSize, page: 0 })),
  on(TableActions.setSort, (state, { sort }) => ({ ...invalidateQuery(state), sort, page: 0 })),
  on(TableActions.setFilter, (state, { filter }) => ({ ...invalidateQuery(state), filter, page: 0 })),
  on(TableActions.setSearch, (state, { search }) => ({ ...invalidateQuery(state), search, page: 0 })),
  on(TableActions.setGroupBy, (state, { groupBy }) => ({ ...invalidateQuery(state), groupBy, page: 0 })),
  on(TableActions.toggleTreeMode, (state) => ({
    ...invalidateQuery(state),
    treeMode: !state.treeMode,
    page: 0,
  })),
  on(TableActions.toggleExpanded, (state, { id }) => ({
    ...invalidateQuery(state),
    expandedIds: state.expandedIds.includes(id)
      ? state.expandedIds.filter((item) => item !== id)
      : [...state.expandedIds, id],
  })),
  on(TableActions.setSelection, (state, { ids }) => ({ ...state, selectedIds: ids })),
  on(TableActions.toggleColumn, (state, { key }) => ({
    ...state,
    visibleColumns: state.visibleColumns.includes(key)
      ? state.visibleColumns.filter((item) => item !== key)
      : [...state.visibleColumns, key],
  })),
  on(TableActions.resizeColumn, (state, { key, width }) => ({
    ...state,
    columnWidths: { ...state.columnWidths, [key]: Math.max(88, width) },
  })),
  on(TableActions.togglePinned, (state, { key }) => ({
    ...state,
    pinnedColumns: state.pinnedColumns.includes(key)
      ? state.pinnedColumns.filter((item) => item !== key)
      : [...state.pinnedColumns, key],
  })),
  on(TableActions.setDensity, (state, { density }) => ({ ...state, density })),
  on(TableActions.updateCell, (state, { id, key, value }) => {
    const cellKey = cellKeyOf(id, key);
    const row = state.rows.find((item) => item.id === id);
    const existing = state.dirtyCells[cellKey];
    const conflict = state.conflicts[cellKey];
    // 基准值/版本：已暂存的修改沿用原基准；冲突单元格以服务端裁决值重新起算
    const baseValue = existing?.baseValue ?? conflict?.serverValue ?? row?.[key] ?? null;
    const baseVersion = existing?.baseVersion ?? conflict?.serverVersion ?? state.cellVersions[cellKey] ?? 0;
    const change: PendingChange = {
      id,
      key,
      orderNo: row?.orderNo ?? existing?.orderNo ?? conflict?.orderNo ?? id,
      value,
      baseValue,
      baseVersion,
    };
    const conflicts = { ...state.conflicts };
    delete conflicts[cellKey];
    return {
      ...state,
      rows: state.rows.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
      dirtyCells: { ...state.dirtyCells, [cellKey]: change },
      conflicts,
    };
  }),
  on(TableActions.saveDirtyCells, (state) => {
    if (!Object.keys(state.dirtyCells).length) {
      return state;
    }
    return { ...state, saving: true, saveError: null };
  }),
  on(TableActions.saveDirtyCellsSuccess, (state, { result }) => {
    const dirtyCells = { ...state.dirtyCells };
    const conflicts = { ...state.conflicts };
    const cellVersions = { ...state.cellVersions };
    let rows = state.rows;
    const patchRow = (id: string, key: keyof TableRow, value: TableRow[keyof TableRow]): void => {
      rows = rows.map((item) => (item.id === id ? { ...item, [key]: value } : item));
    };
    // 成功的单元格先入库，从待提交区移除
    for (const saved of result.saved) {
      const cellKey = cellKeyOf(saved.id, saved.key);
      delete dirtyCells[cellKey];
      delete conflicts[cellKey];
      cellVersions[cellKey] = saved.version;
      patchRow(saved.id, saved.key, saved.value);
    }
    // 版本落后的单元格不覆盖服务端值，移入冲突区等待重试
    for (const conflict of result.conflicts) {
      const cellKey = cellKeyOf(conflict.id, conflict.key);
      delete dirtyCells[cellKey];
      conflicts[cellKey] = conflict;
      cellVersions[cellKey] = conflict.serverVersion;
      patchRow(conflict.id, conflict.key, conflict.serverValue);
    }
    return {
      ...state,
      rows,
      dirtyCells,
      conflicts,
      cellVersions,
      saving: false,
      saveError: null,
      dataVersion: Math.max(state.dataVersion, result.dataVersion),
    };
  }),
  on(TableActions.saveDirtyCellsFailure, (state, { error }) => ({
    ...state,
    saving: false,
    saveError: error,
  })),
  on(TableActions.discardConflict, (state, { id, key }) => {
    const conflicts = { ...state.conflicts };
    delete conflicts[cellKeyOf(id, key)];
    return { ...state, conflicts };
  }),
  on(TableActions.discardDirtyCells, (state) => ({
    ...invalidateQuery(state),
    dirtyCells: {},
  })),
  on(TableActions.externalDataChanged, (state, { dataVersion, cellVersions }) => {
    if (dataVersion <= state.dataVersion) {
      return state;
    }
    return {
      ...invalidateQuery(state),
      dataVersion,
      cellVersions: { ...state.cellVersions, ...cellVersions },
    };
  }),
  on(TableActions.saveView, (state, { name }) => {
    const view: SavedView = {
      id: `view-${Date.now()}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      pageSize: state.pageSize,
      visibleColumns: [...state.visibleColumns],
      columnWidths: { ...state.columnWidths },
      pinnedColumns: [...state.pinnedColumns],
      sort: state.sort,
      filter: state.filter,
      groupBy: state.groupBy,
      treeMode: state.treeMode,
    };
    const savedViews = [...state.savedViews.filter((item) => item.name !== view.name), view];
    persistViews(savedViews);
    return { ...state, savedViews, activeViewId: view.id };
  }),
  on(TableActions.applyView, (state, { view }) => ({
    ...invalidateQuery(state),
    pageSize: view.pageSize,
    visibleColumns: [...view.visibleColumns],
    columnWidths: { ...view.columnWidths },
    pinnedColumns: [...view.pinnedColumns],
    sort: view.sort,
    filter: view.filter,
    groupBy: view.groupBy,
    treeMode: view.treeMode,
    activeViewId: view.id,
    page: 0,
  })),
  on(TableActions.deleteView, (state, { id }) => {
    const savedViews = state.savedViews.filter((view) => view.id !== id);
    persistViews(savedViews);
    return {
      ...state,
      savedViews,
      activeViewId: state.activeViewId === id ? null : state.activeViewId,
    };
  }),
);

function readViews(): SavedView[] {
  try {
    const raw = localStorage.getItem('pair-wise-yy-05:views');
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

function persistViews(views: SavedView[]): void {
  localStorage.setItem('pair-wise-yy-05:views', JSON.stringify(views));
}

function readSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
    if (!parsed || !parsed.filter) {
      return null;
    }
    return {
      savedAt: parsed.savedAt ?? '',
      page: parsed.page ?? 0,
      pageSize: parsed.pageSize ?? 100,
      sort: parsed.sort ?? null,
      filter: parsed.filter,
      search: parsed.search ?? '',
      groupBy: parsed.groupBy ?? null,
      treeMode: parsed.treeMode ?? false,
      dirtyCells: parsed.dirtyCells ?? {},
      conflicts: parsed.conflicts ?? {},
      cellVersions: parsed.cellVersions ?? {},
      dataVersion: parsed.dataVersion ?? 0,
    };
  } catch {
    return null;
  }
}
