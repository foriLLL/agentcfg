import { createInterface } from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import type { Readable, Writable } from 'node:stream';
import { ADAPTER_NAMES, type AdapterName } from '../adapters';
import {
  ApplyValidationError,
  applyPlan,
  planApply,
  plansToResults,
  type ApplyAgentResult,
} from '../core/apply';
import {
  readLocalState,
  MASKED_SECRET,
} from '../core';

export type RunApplyCommandOptions = {
  agent?: AdapterName;
  allAgents?: boolean;
  configPath?: string;
  statePath?: string;
  fixturesRoot?: string;
  dryRun?: boolean;
  yes?: boolean;
  input?: Readable & { isTTY?: boolean };
  output?: Writable & { isTTY?: boolean };
};

export async function runApplyCommand(options: RunApplyCommandOptions): Promise<string> {
  const selectedAgents = selectApplyAgents(options);
  const state = await readLocalState(options.statePath);

  if (state.cache === undefined) {
    throw new Error('No cached agentcfg.yaml found. Run agentcfg pull before apply.');
  }

  let plans;
  try {
    plans = await planApply(state.cache.config, selectedAgents, {
      configPath: options.configPath,
      fixturesRoot: options.fixturesRoot,
    });
  } catch (error) {
    if (error instanceof ApplyValidationError) {
      throw new Error(formatApplyResults(error.results, 'Apply validation failed; no files were written.'));
    }
    throw error;
  }

  if (options.dryRun === true) {
    return formatApplyResults(plansToResults(plans, 'would-change'), 'Dry run: no files written.');
  }

  if (options.yes !== true) {
    const summary = formatApplyResults(plansToResults(plans, 'would-change'), 'Apply requires confirmation.');
    const confirmed = await confirmApply(summary, options.input ?? defaultInput, options.output ?? defaultOutput);
    if (!confirmed) {
      throw new Error(`${summary}\nApply cancelled; no files written.`);
    }
  }

  const results = await applyPlan(plans);
  return formatApplyResults(results, 'Apply complete.');
}

function selectApplyAgents(options: RunApplyCommandOptions): AdapterName[] {
  if (options.agent !== undefined && options.allAgents === true) {
    throw new Error(`Choose exactly one target selector: --agent <${ADAPTER_NAMES.join('|')}> or --all-agents`);
  }

  if (options.agent === undefined && options.allAgents !== true) {
    throw new Error(`Choose exactly one target selector: --agent <${ADAPTER_NAMES.join('|')}> or --all-agents`);
  }

  return options.agent === undefined ? [...ADAPTER_NAMES] : [options.agent];
}

async function confirmApply(
  summary: string,
  input: Readable & { isTTY?: boolean },
  output: Writable & { isTTY?: boolean },
): Promise<boolean> {
  if (input.isTTY !== true) {
    return false;
  }

  output.write(`${summary}\nType yes to apply: `);
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question('');
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    readline.close();
  }
}

function formatApplyResults(results: ApplyAgentResult[], heading: string): string {
  return [heading, ...results.map(formatApplyResult)].join('\n');
}

function formatApplyResult(result: ApplyAgentResult): string {
  const lines = [`Agent: ${result.agent}`, `  Status: ${formatStatus(result.status)}`];

  if (result.configPath !== undefined) {
    lines.push(`  Native config: ${result.configPath}`);
  }
  if (result.envPath !== undefined) {
    lines.push(`  Env file: ${result.envPath}`);
  }
  if (result.error !== undefined) {
    lines.push(`  Error: ${result.error}`);
  }
  if (result.changes.length === 0) {
    lines.push('  No managed changes.');
  } else {
    for (const change of result.changes) {
      lines.push(
        `  ${change.field}: ${formatValue(change.current, change.secret)} -> ${formatValue(
          change.expected,
          change.secret,
        )}`,
      );
    }
  }
  lines.push(...result.notices.map((notice) => `  Notice: ${notice.message}`));
  for (const backupPath of result.backups) {
    lines.push(`  Backup: ${backupPath}`);
  }

  return lines.join('\n');
}

function formatStatus(status: ApplyAgentResult['status']): string {
  if (status === 'would-change') {
    return 'would change';
  }
  return status;
}

function formatValue(value: string | undefined, secret: boolean): string {
  if (value === undefined) {
    return '<missing>';
  }
  return secret ? MASKED_SECRET : value;
}
