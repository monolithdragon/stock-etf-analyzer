/**
 * DCF forgatókönyvek (Bear/Base/Bull) és szenzitivitási tábla – PHASE 07, D-064.
 *
 * Mindkettő KIZÁRÓLAG a `runDcf`-et hívja: egy forgatókönyv = egy feltevés-készlet, egy
 * táblacella = a kiinduló bemenet (r, g) felülírással. Nincs külön, „gyorsított” képlet.
 * A forgatókönyv-címkék csak elnevezések: a feltevések a hívótól jönnek és láthatók maradnak.
 */
import {
  runDcf,
  type DcfAssumptions,
  type DcfCompanyInputs,
  type DcfInput,
  type DcfResult,
} from './dcf';
import { calcInvalidInput, calcOk, mapCalc, type CalcResult } from '../core/calc-result';

// --- Forgatókönyvek ---------------------------------------------------------------------------

export const DCF_SCENARIO_IDS = ['bear', 'base', 'bull'] as const;
export type DcfScenarioId = (typeof DCF_SCENARIO_IDS)[number];

export type DcfScenarioSet = Readonly<Record<DcfScenarioId, DcfAssumptions>>;

export interface DcfScenarioResult {
  readonly id: DcfScenarioId;
  /** A ténylegesen használt feltevések – az eredmény mellett mindig megjelenítendők. */
  readonly assumptions: DcfAssumptions;
  readonly result: CalcResult<DcfResult>;
}

export interface DcfScenarioRun {
  readonly scenarios: readonly DcfScenarioResult[];
  /** Forgatókönyvek közti konzisztencia-megjegyzések (pl. nem monoton sorrend). */
  readonly notes: readonly string[];
}

/** Mindhárom forgatókönyv ugyanazokkal a cégadatokkal, ugyanazzal az engine-nel. */
export function runDcfScenarios(company: DcfCompanyInputs, set: DcfScenarioSet): DcfScenarioRun {
  const scenarios = DCF_SCENARIO_IDS.map((id) => ({
    id,
    assumptions: set[id],
    result: runDcf({ ...company, ...set[id] }),
  }));
  const notes: string[] = [];
  const values = scenarios.map((s) =>
    s.result.status === 'OK' ? s.result.value.intrinsicValuePerShare : null,
  );
  const [bear = null, base = null, bull = null] = values;
  if (bear !== null && base !== null && bull !== null && !(bear <= base && base <= bull)) {
    notes.push(
      'A belső értékek nem a Bear ≤ Base ≤ Bull sorrendet követik – ellenőrizd a feltevéseket (a címkék csak elnevezések, a feltevések döntenek).',
    );
  }
  const failed = scenarios.filter((s) => s.result.status !== 'OK').map((s) => s.id);
  if (failed.length > 0 && failed.length < scenarios.length) {
    notes.push(
      `Nem minden forgatókönyv számolható: ${failed.join(', ')} (az okot lásd az adott eredménynél).`,
    );
  }
  return { scenarios, notes };
}

// --- Szenzitivitási tábla ---------------------------------------------------------------------

/** Tengelyenként legfeljebb ennyi érték (olvashatóság és számítási költség). */
export const DCF_SENSITIVITY_MAX_AXIS = 11;

export interface DcfSensitivityCell {
  readonly discountRate: number;
  readonly terminalGrowth: number;
  /** A `runDcf` belső érték/részvény eredménye – vagy jól definiált nem-OK státusz (pl. r ≤ g). */
  readonly intrinsicValuePerShare: CalcResult<number>;
}

export interface DcfSensitivityRow {
  readonly discountRate: number;
  readonly cells: readonly DcfSensitivityCell[];
}

export interface DcfSensitivityTable {
  readonly discountRates: readonly number[];
  readonly terminalGrowthRates: readonly number[];
  /** Sor = diszkontráta, oszlop = terminális növekedés (a megadott sorrendben). */
  readonly rows: readonly DcfSensitivityRow[];
}

function checkAxis(name: string, values: readonly number[]): string | null {
  if (values.length === 0 || values.length > DCF_SENSITIVITY_MAX_AXIS) {
    return `A(z) ${name} tengely ${values.length} értéket tartalmaz; 1–${DCF_SENSITIVITY_MAX_AXIS} megengedett.`;
  }
  if (values.some((v) => !Number.isFinite(v))) return `A(z) ${name} tengelyen nem véges szám van.`;
  if (new Set(values).size !== values.length) return `A(z) ${name} tengelyen ismétlődő érték van.`;
  return null;
}

/**
 * Szenzitivitási tábla: minden cella `runDcf({ ...base, discountRate, terminalGrowth })`.
 * A tengelyek hibája (üres, túl hosszú, nem véges, ismétlődő) `INVALID_INPUT`; a cellák
 * hibája (pl. `r ≤ g`) a cellában marad, a tábla többi része érvényes.
 */
export function dcfSensitivityTable(input: {
  readonly base: DcfInput;
  readonly discountRates: readonly number[];
  readonly terminalGrowthRates: readonly number[];
}): CalcResult<DcfSensitivityTable> {
  const axisError =
    checkAxis('diszkontráta', input.discountRates) ??
    checkAxis('terminális növekedés', input.terminalGrowthRates);
  if (axisError !== null) return calcInvalidInput(axisError);
  const rows = input.discountRates.map((discountRate) => ({
    discountRate,
    cells: input.terminalGrowthRates.map((terminalGrowth) => ({
      discountRate,
      terminalGrowth,
      intrinsicValuePerShare: mapCalc(
        runDcf({ ...input.base, discountRate, terminalGrowth }),
        (r) => r.intrinsicValuePerShare,
      ),
    })),
  }));
  return calcOk({
    discountRates: [...input.discountRates],
    terminalGrowthRates: [...input.terminalGrowthRates],
    rows,
  });
}

/** A tengelyértékek lebegőpontos zajának levágása (0.09 + 0.01 → 0.1, nem 0.09999999999999999). */
const cleanAxisValue = (value: number): number => Number(value.toFixed(10));

/**
 * Szimmetrikus tengely egy középérték körül: `sensitivityAxis(0.09, 0.01, 2)` →
 * `[0.07, 0.08, 0.09, 0.1, 0.11]`. `step > 0`, `stepsEachSide` egész, 0–5.
 */
export function sensitivityAxis(
  center: number,
  step: number,
  stepsEachSide: number,
): CalcResult<number[]> {
  if (!Number.isFinite(center) || !Number.isFinite(step)) {
    return calcInvalidInput('A tengely középértéke és lépésköze véges szám kell legyen.');
  }
  if (step <= 0) return calcInvalidInput(`A lépésköz pozitív kell legyen (${step}).`);
  const maxSteps = (DCF_SENSITIVITY_MAX_AXIS - 1) / 2;
  if (!Number.isInteger(stepsEachSide) || stepsEachSide < 0 || stepsEachSide > maxSteps) {
    return calcInvalidInput(
      `Az oldalankénti lépésszám egész szám 0 és ${maxSteps} között (${stepsEachSide}).`,
    );
  }
  return calcOk(
    Array.from({ length: 2 * stepsEachSide + 1 }, (_, i) =>
      cleanAxisValue(center + (i - stepsEachSide) * step),
    ),
  );
}
