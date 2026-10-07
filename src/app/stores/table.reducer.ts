import { createReducer, on } from '@ngrx/store';
import {
  AggregateResult,
  CellValue,
  ConflictItem,
  FilterGroup,
  PendingCell,
  PersistedSnapshot,
  SavedView,
  TableRow,
  TableState,
} from '../types/table.models';
import * as TableActions from './table.actions';

const EMPTY_AGGREGATE: AggregateResult = { amount: 0, quantity: 0, averageMargin: 0 };

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

const SESSION_KEY = 'pair-wise-yy-05:session';
const VIEWS_KEY = 'pair-wise-yy-05:views';

const initialVisibleColumns = TABLE_COLUMNS.map((column) => column.key);
const initialWidths = Object.fromEntries(
  TABLE_COLUMNS.map((column) => [
    column.key,
    ['orderNo', 'customer'].includes(String(column.key)) ? 190 : 132,
  ]),
);

function readViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

function persistViews(views: SavedView[]): void {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}

function readSnapshot(): PersistedSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSnapshot;
    if (parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cellKey(id: string, field: keyof TableRow): string {
  return `${id}::${String(field)}`;
}

/** 在服务端快照行上叠加待提交覆盖，得到展示行 */
function applyOverlays(rows: TableRow[], dirtyCells: Record<string, PendingCell>): TableRow[] {
  const pendingKeys = Object.keys(dirtyCells);
  if (!pendingKeys.length) {
    return rows;
  }
  return rows.map((row) => {
    let next = row;
    for (const key of pendingKeys) {
      const sep = key.indexOf('::');
      const id = key.slice(0, sep);
      const field = key.slice(sep + 2) as keyof TableRow;
      if (id === row.id) {
        next = { ...next, [field]: dirtyCells[key].value };
      }
    }
    return next;
  });
}

function buildInitialState(): TableState {
  const persisted = readSnapshot();
  const initialViews = readViews();
  const hasSnapshot = !!persisted;

  return {
    querySession: 0,
    dataVersion: persisted?.dataVersion ?? 1,
    recovering: hasSnapshot,
    serverRows: persisted?.snapshot.rows ?? [],
    rows: hasSnapshot
      ? applyOverlays(persisted.snapshot.rows, persisted.dirtyCells)
      : [],
    total: persisted?.snapshot.total ?? 0,
    groups: persisted?.snapshot.groups ?? [],
    aggregates: persisted?.snapshot.aggregates ?? EMPTY_AGGREGATE,
    loading: false,
    stale: false,
    error: null,
    page: persisted?.query.page ?? 0,
    pageSize: persisted?.query.pageSize ?? 100,
    sort: persisted?.query.sort ?? { field: 'updatedAt', direction: 'desc' },
    filter: persisted?.query.filter ?? EMPTY_FILTER,
    search: persisted?.query.search ?? '',
    groupBy: persisted?.query.groupBy ?? null,
    treeMode: persisted?.query.treeMode ?? false,
    expandedIds: persisted?.query.expandedIds ?? [],
    selectedIds: [],
    visibleColumns: initialVisibleColumns,
    columnWidths: initialWidths,
    pinnedColumns: ['orderNo', 'customer'],
    density: 'standard',
    elapsedMs: 0,
    savedViews: initialViews,
    activeViewId: null,
    cellVersions: persisted?.cellVersions ?? {},
    dirtyCells: persisted?.dirtyCells ?? {},
    conflicts: persisted?.conflicts ?? {},
    saving: false,
    saveError: null,
    hydrated: !hasSnapshot,
    lastSavedAt: null,
  };
}

export const initialState: TableState = buildInitialState();

export const tableReducer = createReducer(
  initialState,

  // === 查询会话 ===
  on(TableActions.loadPage, (state) => ({
    ...state,
    loading: true,
    error: null,
    stale: false,
    querySession: state.querySession + 1,
  })),
  on(TableActions.loadPageSuccess, (state, { result }) => {
    // 恢复后的首查：无条件接受结果并对齐数据版本
    if (!state.recovering) {
      if (result.sessionId !== state.querySession) {
        // 旧会话的迟到结果：直接丢弃，不覆盖页面
        return state;
      }
      if (result.dataVersion !== state.dataVersion) {
        // 数据版本已变化：结果失效，保留旧快照并标记过期
        return { ...state, stale: true, loading: false };
      }
    }
    const serverRows = result.rows;
    return {
      ...state,
      recovering: false,
      serverRows,
      rows: applyOverlays(serverRows, state.dirtyCells),
      total: result.total,
      groups: result.groups,
      aggregates: result.aggregates,
      cellVersions: { ...state.cellVersions, ...result.versions },
      loading: false,
      stale: false,
      elapsedMs: result.elapsedMs,
      error: null,
      dataVersion: result.dataVersion,
    };
  }),
  on(TableActions.loadPageFailure, (state, { error, sessionId, dataVersion }) => {
    if (!state.recovering && (sessionId !== state.querySession || dataVersion !== state.dataVersion)) {
      return state;
    }
    // 查询失败：保留已有快照与未提交修改，仅提示错误
    return { ...state, loading: false, error, recovering: false };
  }),
  on(TableActions.setPage, (state, { page }) => ({
    ...state,
    page,
    loading: true,
    error: null,
    querySession: state.querySession + 1,
  })),
  on(TableActions.setPageSize, (state, { pageSize }) => ({
    ...state,
    pageSize,
    page: 0,
    loading: true,
    error: null,
    querySession: state.querySession + 1,
  })),
  on(TableActions.setSort, (state, { sort }) => ({
    ...state,
    sort,
    page: 0,
    loading: true,
    error: null,
    querySession: state.querySession + 1,
  })),
  on(TableActions.setFilter, (state, { filter }) => ({
    ...state,
    filter,
    page: 0,
    loading: true,
    error: null,
    querySession: state.querySession + 1,
  })),
  on(TableActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 0,
    loading: true,
    error: null,
    querySession: state.querySession + 1,
  })),
  on(TableActions.setGroupBy, (state, { groupBy }) => ({
    ...state,
    groupBy,
    page: 0,
    loading: true,
    error: null,
    querySession: state.querySession + 1,
  })),
  on(TableActions.toggleTreeMode, (state) => ({
    ...state,
    treeMode: !state.treeMode,
    page: 0,
    loading: true,
    error: null,
    querySession: state.querySession + 1,
  })),
  on(TableActions.toggleExpanded, (state, { id }) => ({
    ...state,
    expandedIds: state.expandedIds.includes(id)
      ? state.expandedIds.filter((item) => item !== id)
      : [...state.expandedIds, id],
    loading: true,
    error: null,
    querySession: state.querySession + 1,
  })),

  // === 选择与列状态 ===
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

  // === 单元格编辑与保存 ===
  on(TableActions.updateCell, (state, { id, key, value }) => {
    const ck = cellKey(id, key);
    // 若该单元格此前在冲突区，重新编辑后以服务端最新版本为基准进入待提交
    const baseVersion = state.conflicts[ck]?.serverVersion ?? state.cellVersions[ck] ?? 1;
    const { [ck]: _removed, ...restConflicts } = state.conflicts;
    return {
      ...state,
      rows: state.rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
      dirtyCells: { ...state.dirtyCells, [ck]: { value, baseVersion } },
      conflicts: restConflicts,
    };
  }),
  on(TableActions.saveCells, (state) => ({ ...state, saving: true, saveError: null })),
  on(TableActions.saveCellsSuccess, (state, { response }) => {
    let dirtyCells = { ...state.dirtyCells };
    let conflicts = { ...state.conflicts };
    let serverRows = state.serverRows;
    let cellVersions = { ...state.cellVersions };

    for (const r of response.results) {
      const ck = cellKey(r.id, r.field);
      if (r.status === 'saved') {
        delete dirtyCells[ck];
        delete conflicts[ck];
        cellVersions[ck] = r.version ?? cellVersions[ck] ?? 1;
        serverRows = serverRows.map((row) =>
          row.id === r.id ? { ...row, [r.field]: r.value as CellValue } : row,
        );
      } else if (r.status === 'conflict') {
        delete dirtyCells[ck];
        conflicts[ck] = {
          id: r.id,
          field: r.field,
          localValue: r.localValue,
          serverValue: r.serverValue as CellValue,
          serverVersion: r.serverVersion ?? cellVersions[ck] ?? 1,
          baseVersion: r.baseVersion,
          reason: 'conflict',
        };
        cellVersions[ck] = r.serverVersion ?? cellVersions[ck] ?? 1;
      } else if (r.status === 'missing') {
        delete dirtyCells[ck];
        conflicts[ck] = {
          id: r.id,
          field: r.field,
          localValue: r.localValue,
          serverValue: null,
          serverVersion: r.serverVersion ?? 0,
          baseVersion: r.baseVersion,
          reason: 'missing',
        };
      }
    }

    return {
      ...state,
      dirtyCells,
      conflicts,
      serverRows,
      rows: applyOverlays(serverRows, dirtyCells),
      cellVersions,
      dataVersion: response.dataVersion,
      saving: false,
      saveError: null,
      lastSavedAt: new Date().toISOString(),
    };
  }),
  on(TableActions.saveCellsFailure, (state, { error }) => ({
    ...state,
    saving: false,
    saveError: error,
  })),
  on(TableActions.retryConflict, (state) => ({ ...state, saving: true })),
  on(TableActions.retryAllConflicts, (state) => ({ ...state, saving: true })),
  on(TableActions.discardConflict, (state, { id, field }) => {
    const ck = cellKey(id, field);
    const { [ck]: _removed, ...restConflicts } = state.conflicts;
    const serverRow = state.serverRows.find((row) => row.id === id);
    const rows = serverRow
      ? state.rows.map((row) => (row.id === id ? { ...row, [field]: serverRow[field] } : row))
      : state.rows;
    return { ...state, conflicts: restConflicts, rows };
  }),
  on(TableActions.discardAllConflicts, (state) => {
    const conflictKeys = Object.keys(state.conflicts);
    if (!conflictKeys.length) {
      return state;
    }
    const rows = state.rows.map((row) => {
      let next = row;
      for (const ck of conflictKeys) {
        const sep = ck.indexOf('::');
        const id = ck.slice(0, sep);
        const field = ck.slice(sep + 2) as keyof TableRow;
        if (id === row.id) {
          const serverRow = state.serverRows.find((r) => r.id === id);
          if (serverRow) {
            next = { ...next, [field]: serverRow[field] };
          }
        }
      }
      return next;
    });
    return { ...state, conflicts: {}, rows };
  }),
  on(TableActions.discardAllPending, (state) => {
    if (!Object.keys(state.dirtyCells).length) {
      return state;
    }
    return { ...state, dirtyCells: {}, rows: applyOverlays(state.serverRows, {}) };
  }),

  // === 外部标签页变更 ===
  on(TableActions.simulateExternalChangeSuccess, (state, { response }) => ({
    ...state,
    dataVersion: response.dataVersion,
    cellVersions: { ...state.cellVersions, ...response.versions },
    stale: true,
  })),

  // === 视图 ===
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
    ...state,
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
    loading: true,
    error: null,
    querySession: state.querySession + 1,
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
