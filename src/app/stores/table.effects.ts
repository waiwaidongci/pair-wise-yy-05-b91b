import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, filter, map, of, switchMap, tap, withLatestFrom } from 'rxjs';
import { Store } from '@ngrx/store';
import { MockTableApiService } from '../data/mock-table-api.service';
import * as TableActions from './table.actions';
import { SESSION_STORAGE_KEY } from './table.reducer';
import { selectTableState } from './table.selectors';
import { SessionSnapshot, TableState } from '../types/table.models';

@Injectable()
export class TableEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly api = inject(MockTableApiService);

  loadPage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        TableActions.loadPage,
        TableActions.setPage,
        TableActions.setPageSize,
        TableActions.setSort,
        TableActions.setFilter,
        TableActions.setSearch,
        TableActions.setGroupBy,
        TableActions.toggleTreeMode,
        TableActions.toggleExpanded,
        TableActions.applyView,
        TableActions.discardDirtyCells,
        TableActions.externalDataChanged,
      ),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([, state]) => {
        const queryVersion = state.queryVersion;
        return this.api
          .query({
            page: state.page,
            pageSize: state.pageSize,
            sort: state.sort,
            filter: state.filter,
            groupBy: state.groupBy,
            treeMode: state.treeMode,
            expandedIds: state.expandedIds,
            search: state.search,
          })
          .pipe(
            map((result) => TableActions.loadPageSuccess({ result, queryVersion })),
            catchError((error: unknown) =>
              of(TableActions.loadPageFailure({ error: String(error), queryVersion })),
            ),
          );
      }),
    ),
  );

  saveDirtyCells$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.saveDirtyCells),
      withLatestFrom(this.store.select(selectTableState)),
      filter(([, state]) => Object.keys(state.dirtyCells).length > 0),
      switchMap(([, state]) => {
        const changes = Object.values(state.dirtyCells).map((change) => ({
          id: change.id,
          key: change.key,
          value: change.value,
          baseVersion: change.baseVersion,
        }));
        return this.api.saveBatch(changes).pipe(
          map((result) => TableActions.saveDirtyCellsSuccess({ result })),
          catchError((error: unknown) =>
            of(TableActions.saveDirtyCellsFailure({ error: String(error) })),
          ),
        );
      }),
    ),
  );

  retryConflict$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.retryConflict),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([action, state]) => {
        const conflict = state.conflicts[`${action.id}::${String(action.key)}`];
        if (!conflict) {
          return of();
        }
        // 以服务端最新版本为基准重试，落后的值不会覆盖服务端
        return this.api
          .saveBatch([{
            id: conflict.id,
            key: conflict.key,
            value: conflict.localValue,
            baseVersion: conflict.serverVersion,
          }])
          .pipe(
            map((result) => TableActions.saveDirtyCellsSuccess({ result })),
            catchError((error: unknown) =>
              of(TableActions.saveDirtyCellsFailure({ error: String(error) })),
            ),
          );
      }),
    ),
  );

  /** 保存成功后数据版本已变化，刷新当前查询使统计与行数据保持最新。 */
  refreshAfterSave$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.saveDirtyCellsSuccess),
      map(() => TableActions.loadPage({ refresh: true })),
    ),
  );

  persistSession$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          TableActions.loadPageSuccess,
          TableActions.setPage,
          TableActions.setPageSize,
          TableActions.setSort,
          TableActions.setFilter,
          TableActions.setSearch,
          TableActions.setGroupBy,
          TableActions.toggleTreeMode,
          TableActions.applyView,
          TableActions.updateCell,
          TableActions.saveDirtyCellsSuccess,
          TableActions.saveDirtyCellsFailure,
          TableActions.discardConflict,
          TableActions.discardDirtyCells,
          TableActions.externalDataChanged,
        ),
        withLatestFrom(this.store.select(selectTableState)),
        tap(([, state]) => persistSession(state)),
      ),
    { dispatch: false },
  );
}

function persistSession(state: TableState): void {
  const snapshot: SessionSnapshot = {
    savedAt: new Date().toISOString(),
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    filter: state.filter,
    search: state.search,
    groupBy: state.groupBy,
    treeMode: state.treeMode,
    dirtyCells: state.dirtyCells,
    conflicts: state.conflicts,
    cellVersions: state.cellVersions,
    dataVersion: state.dataVersion,
  };
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 存储不可用时静默失败，不阻断编辑会话
  }
}
