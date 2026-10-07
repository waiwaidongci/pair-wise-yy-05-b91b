import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  catchError,
  concat,
  concatMap,
  debounceTime,
  filter,
  from,
  map,
  of,
  switchMap,
  tap,
  withLatestFrom,
} from 'rxjs';
import { MockTableApiService } from '../data/mock-table-api.service';
import { CellEdit, CellValue, TableRow } from '../types/table.models';
import * as TableActions from './table.actions';
import { selectPersistableSnapshot, selectTableState } from './table.selectors';

const SESSION_KEY = 'pair-wise-yy-05:session';

interface ConflictRetry {
  id: string;
  field: keyof TableRow;
  localValue: CellValue;
  serverVersion: number;
}

@Injectable()
export class TableEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly api = inject(MockTableApiService);

  /**
   * 查询会话：任何查询条件变化、保存成功、外部变更都会发起新会话。
   * 每次查询携带 sessionId + dataVersion，迟到的旧结果由 reducer 直接丢弃。
   */
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
        TableActions.saveCellsSuccess,
        TableActions.simulateExternalChangeSuccess,
      ),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([, state]) =>
        this.api
          .query({
            page: state.page,
            pageSize: state.pageSize,
            sort: state.sort,
            filter: state.filter,
            groupBy: state.groupBy,
            treeMode: state.treeMode,
            expandedIds: state.expandedIds,
            search: state.search,
            sessionId: state.querySession,
            dataVersion: state.dataVersion,
          })
          .pipe(
            map((result) => TableActions.loadPageSuccess({ result })),
            catchError((error: unknown) =>
              of(
                TableActions.loadPageFailure({
                  error: String(error),
                  sessionId: state.querySession,
                  dataVersion: state.dataVersion,
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /**
   * 数据版本变化导致旧结果失效后，自动用新版本重新查询，
   * 保证页面只展示新数据版本下的订单行与统计。
   */
  requeryOnStale$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.loadPageSuccess),
      withLatestFrom(this.store.select(selectTableState)),
      filter(
        ([{ result }, state]) =>
          !state.recovering &&
          result.sessionId === state.querySession &&
          result.dataVersion !== state.dataVersion,
      ),
      map(() => TableActions.loadPage()),
    ),
  );

  /** 整批保存：成功的先入库，失败项保留在冲突区，不回退已完成部分 */
  saveCells$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.saveCells),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([, state]) => {
        const edits: CellEdit[] = Object.entries(state.dirtyCells).map(([key, pending]) => {
          const sep = key.indexOf('::');
          return {
            id: key.slice(0, sep),
            field: key.slice(sep + 2) as CellEdit['field'],
            value: pending.value,
            baseVersion: pending.baseVersion,
          };
        });
        if (!edits.length) {
          return of(
            TableActions.saveCellsSuccess({
              response: { results: [], dataVersion: state.dataVersion },
            }),
          );
        }
        return this.api.saveCells(edits).pipe(
          map((response) => TableActions.saveCellsSuccess({ response })),
          catchError((error: unknown) => of(TableActions.saveCellsFailure({ error: String(error) }))),
        );
      }),
    ),
  );

  /** 单独重试某个冲突项：以服务端最新版本为基准重新提交 */
  retryConflict$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.retryConflict),
      withLatestFrom(this.store.select(selectTableState)),
      filter(([{ id, field }, state]) => !!state.conflicts[`${id}::${String(field)}`]),
      switchMap(([{ id, field }, state]) => {
        const conflict = state.conflicts[`${id}::${String(field)}`];
        return concat(
          of(TableActions.saveCells()),
          this.api
            .saveCells([
              {
                id,
                field,
                value: conflict.localValue,
                baseVersion: conflict.serverVersion,
              },
            ])
            .pipe(
              map((response) => TableActions.saveCellsSuccess({ response })),
              catchError((error: unknown) => of(TableActions.saveCellsFailure({ error: String(error) }))),
            ),
        );
      }),
    ),
  );

  /** 逐个重试所有冲突项：每一项独立裁决，保留部分成功结果 */
  retryAllConflicts$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.retryAllConflicts),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([, state]) => {
        const conflicts: ConflictRetry[] = Object.values(state.conflicts).map((conflict) => ({
          id: conflict.id,
          field: conflict.field,
          localValue: conflict.localValue,
          serverVersion: conflict.serverVersion,
        }));
        if (!conflicts.length) {
          return of(
            TableActions.saveCellsSuccess({
              response: { results: [], dataVersion: state.dataVersion },
            }),
          );
        }
        return concat(
          of(TableActions.saveCells()),
          from(conflicts).pipe(
            concatMap((conflict) =>
              this.api
                .saveCells([
                  {
                    id: conflict.id,
                    field: conflict.field,
                    value: conflict.localValue,
                    baseVersion: conflict.serverVersion,
                  },
                ])
                .pipe(
                  map((response) => TableActions.saveCellsSuccess({ response })),
                  catchError((error: unknown) =>
                    of(TableActions.saveCellsFailure({ error: String(error) })),
                  ),
                ),
            ),
          ),
        );
      }),
    ),
  );

  /** 模拟另一个标签页抢先保存，制造版本冲突 */
  simulateExternalChange$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TableActions.simulateExternalChange),
      withLatestFrom(this.store.select(selectTableState)),
      switchMap(([, state]) => {
        const pendingKeys = Object.keys(state.dirtyCells);
        return this.api.simulateExternalChange(pendingKeys).pipe(
          map((response) => TableActions.simulateExternalChangeSuccess({ response })),
          catchError((error: unknown) => of(TableActions.saveCellsFailure({ error: String(error) }))),
        );
      }),
    ),
  );

  /** 持久化会话快照（防抖）：刷新后可恢复快照与未提交修改 */
  persistSession$ = createEffect(
    () =>
      this.store.select(selectPersistableSnapshot).pipe(
        debounceTime(500),
        tap((snapshot) => {
          try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
          } catch {
            // 存储不可用时静默失败，不影响编辑
          }
        }),
      ),
    { dispatch: false },
  );
}
