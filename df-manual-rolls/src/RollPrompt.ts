import ManualRolls from "./ManualRolls";
import SETTINGS from "../../common/Settings";

interface RollPromptData {
	id: number;
	res: AnyFunction;
	term: DiceTerm;
}
interface RenderData {
	id: string;
	idx: number;
	faces: string;
	hasTotal: boolean;
	term: DiceTerm
}

export default class RollPrompt extends FormApplication<FormApplicationOptions, { terms: RenderData[] }> {

	static readonly PREF_FOCUS_INPUT = 'focus-input';

	private _nextId = 0;
	private _terms: RollPromptData[] = [];
	private _rolled = false;

	static get focusInput(): boolean { return SETTINGS.get(RollPrompt.PREF_FOCUS_INPUT); }

	static get defaultOptions(): FormApplicationOptions {
		return <FormApplicationOptions>foundry.utils.mergeObject(
			<DeepPartial<FormApplicationOptions>>FormApplication.defaultOptions,
			{
				title: game.i18n.localize("DF_MANUAL_ROLLS.Prompt.DefaultTitle"),
				template: `modules/${SETTINGS.MOD_NAME}/templates/roll-prompt.hbs`,
				width: 400,

			});
	}

	getData(_options?: Application.RenderOptions): { terms: RenderData[] } {
		const data: RenderData[] = [];
		for (const term of this._terms) {
			const die = term.term;
			for (let c = 0; c < die.number; c++) {
				data.push({
					id: term.id.toString(),
					idx: c,
					faces: c == 0 ? `${die.number}d${die.faces}${die.modifiers.length > 0 ? ' [' + die.modifiers.join(',') + ']' : ''}` : '',
					hasTotal: c == 0 && die.modifiers.length == 0 && die.number > 1,
					term: die
				});
			}
		}
		return { terms: data };
	}
	close(options?: FormApplication.CloseOptions): Promise<void> {
		// If we have not actually rolled anything yet, we need to resolve these with RNG values
		if (!this._rolled) {
			this._rolled = true;
			for (const x of this._terms) {
				const results: number[] = [];
				for (let c = 0; c < x.term.number; c++) {
					results.push(Math.ceil(CONFIG.Dice.randomUniform() * x.term.faces));
				}
				x.res(results);
			}
		}
		return super.close(options);
	}
	render(force?: boolean, options?: Application.RenderOptions) {
		if (this._terms.length == 0) return;
		return super.render(force, options);
	}
	async _render(force?: boolean, options?: Application.RenderOptions) {
		await super._render(force, options);
		if (RollPrompt.focusInput)
			this.element.find('input')[0].focus();
	}
	protected _updateObject(_: Event, formData?: { [key: string]: string | null }): Promise<unknown> {
		for (const x of this._terms) {
			const results: number[] = [];
			const total = formData[`${x.id}-total`];
			// If a total input was defined and given, it overrides everything else.
			if (total !== undefined && total !== null) {
				const value = parseInt(total);
				results.push(...RollPrompt.distributeRoll(value, x.term.number, x.term.faces));
				if (ManualRolls.flagged)
					x.term.options.flavor = (x.term.options.flavor || '') + '[MRT]';
			} else {
				const flags = [];
				for (let c = 0; c < x.term.number; c++) {
					const roll = formData[`${x.id}-${c}`];
					let value = parseInt(roll);
					if (isNaN(value)) {
						value = Math.ceil(CONFIG.Dice.randomUniform() * x.term.faces);
						flags.push('RN');
					} else {
						flags.push('MR');
						(<any>x.term.options).isManualRoll = true;
					}
					results.push(value);
				}
				if (ManualRolls.flagged && flags.some(x => x === 'MR')) {
					x.term.options.flavor = (x.term.options.flavor || '') + '[' + flags.join(',') + ']';
					(<any>x.term.options).isManualRoll = true;
				}
			}
			x.res(results);
		}
		this._rolled = true;
		return undefined;
	}

	requestResult(term: DiceTerm): Promise<number[]> {
		return new Promise((res, _) => this._terms.push({ id: this._nextId++, res, term }));
	}

	static distributeRoll(total: number, count: number, faces: number): number[] {
		const results: number[] = new Array(count).fill(1);
		let remaining = total - count;

		// Fisher-Yates shuffle of indices for random distribution
		const indices = Array.from({ length: count }, (_, i) => i);
		for (let i = count - 1; i > 0; i--) {
			const j = Math.floor(CONFIG.Dice.randomUniform() * (i + 1));
			[indices[i], indices[j]] = [indices[j], indices[i]];
		}

		// First pass: randomly allocate points to each die
		for (const idx of indices) {
			if (remaining <= 0) break;
			const capacity = faces - results[idx];
			const maxAdd = Math.min(remaining, capacity);
			const amount = Math.floor(CONFIG.Dice.randomUniform() * (maxAdd + 1));
			results[idx] += amount;
			remaining -= amount;
		}

		// Second pass: fill any remaining points that weren't allocated randomly
		for (const idx of indices) {
			if (remaining <= 0) break;
			const capacity = faces - results[idx];
			const amount = Math.min(remaining, capacity);
			results[idx] += amount;
			remaining -= amount;
		}

		return results;
	}
}