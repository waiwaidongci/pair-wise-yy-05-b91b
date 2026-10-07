import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TABLE_COLUMNS } from './table.reducer';
import { PersistedSnapshot, TableRow, TableState } from '../types/table.models';

export const selectTableState = createFeatureSelector<TableState>('table');

export const selectVisibleColumnDefinitions = createSelector(selectTableState, (state) =>
  TABLE_COLUMNS.filter((column) => state.visibleColumns.includes(column.key)).map((column) => ({
    ...column,
    width: state.columnWidths[column.key] ?? 132,
    pinned: state.pinnedColumns.includes(column.key),
  })),
);

export const selectAllColumnDefinitions = createSelector(selectTableState, (state) =>
  TABLE_COLUMNS.map((column) => ({
    ...column,
    visible: state.visibleColumns.includes(column.key),
    pinned: state.pinnedColumns.includes(column.key),
  })),
);

export const selectPageCount = createSelector(
  selectTableState,
  (state) => Math.max(1, Math.ceil(state.total / state.pageSize)),
);

export const selectSelectionMode = createSelector(selectTableState, (state) => ({
  allVisibleSelected:
    state.rows.length > 0 && state.rows.every((row) => state.selectedIds.includes(row.id)),
  count: state.selectedIds.length,
}));

export const selectPendingCount = createSelector(
  selectTableState,
  (state) => Object.keys(state.dirtyCells).length,
);

export const selectConflictCount = createSelector(
  selectTableState,
  (state) => Object.keys(state.conflicts).length,
);

export const selectSaving = createSelector(selectTableState, (state) => state.saving);

export const selectPendingList = createSelector(selectTableState, (state) =>
  Object.entries(state.dirtyCells).map(([key, pending]) => {
    const sep = key.indexOf('::');
    return {
      id: key.slice(0, sep),
      field: key.slice(sep + 2) as keyof TableRow,
      value: pending.value,
      baseVersion: pending.baseVersion,
    };
  }),
);

export const selectConflictList = createSelector(selectTableState, (state) =>
  Object.values(state.conflicts),
);

/** 持久化到 localStorage 的会话快照 */
export const selectPersistableSnapshot = createSelector(
  selectTableState,
  (state): PersistedSnapshot => ({
    schemaVersion: 1,
    dataVersion: state.dataVersion,
    query: {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      filter: state.filter,
      search: state.search,
      groupBy: state.groupBy,
      treeMode: state.treeMode,
      expandedIds: state.expandedIds,
    },
    snapshot: {
      rows: state.serverRows,
      total: state.total,
      aggregates: state.aggregates,
      groups: state.groups,
    },
    cellVersions: state.cellVersions,
    dirtyCells: state.dirtyCells,
    conflicts: state.conflicts,
    savedViews: state.savedViews,
  }),
);
