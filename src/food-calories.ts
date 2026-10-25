type ObjectData = Record<string, unknown>;
function object(value: unknown): value is ObjectData {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Reject empty strings, coercible booleans and non-decimal/negative values.
function numeric(value: unknown): number | null {
	if (typeof value !== "number" && typeof value !== "string") return null;
	if (typeof value === "string" && !/^\s*\d+(?:\.\d+)?(?:e[+-]?\d+)?\s*$/i.test(value)) return null;
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

function calculate(record: ObjectData): number | null {
	if (!object(record.ntr) || typeof record.unit !== "string") return null;
	const amount = numeric(record.amount);
	const cal = numeric(record.ntr.cal);
	if (amount === null || cal === null) return null;
	const unit = record.unit.trim();
	let gramsPerUnit = 1;
	if (unit !== "g" && unit !== "克") {
		if (!unit || !Array.isArray(record.ntr.foodUnit)) return null;
		const matches = record.ntr.foodUnit.filter(entry => object(entry) && entry.unit === unit);
		if (!matches.length) return null;
		const grams = matches.map(entry => {
			// The documented gram is per unit. A non-unit count has no confirmed semantics.
			if (entry.count !== undefined && numeric(entry.count) !== 1) return null;
			return numeric(entry.gram);
		});
		if (grams.some(value => value === null || value <= 0 || value !== grams[0])) return null;
		gramsPerUnit = grams[0]!;
	}
	const total = amount / 100 * gramsPerUnit * cal;
	if (!Number.isFinite(total) || !Number.isFinite(total * 100)) return null;
	return Math.round(total * 100) / 100;
}

/** Enrich only documented food records, leaving upstream totals and fields intact. */
export function withFoodCalories(res: unknown): unknown {
	if (!object(res) || !Array.isArray(res.days)) return res;
	return { ...res, days: res.days.map(day => {
		if (!object(day) || !object(day.foods) || !Array.isArray(day.foods.records)) return day;
		return { ...day, foods: { ...day.foods, records: day.foods.records.map(record => {
			if (!object(record) || Object.prototype.hasOwnProperty.call(record, "totalCal")) return record;
			return { ...record, totalCal: calculate(record) };
		}) } };
	}) };
}
