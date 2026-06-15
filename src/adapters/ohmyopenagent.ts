import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  OH_MY_OPENAGENT_AGENT_NAMES,
  OH_MY_OPENAGENT_CATEGORY_NAMES,
  parseNativeConfig,
  serializeNativeConfig,
  type CanonicalAgentConfig,
  type ManagedDiffChange,
  type NativeConfigObject,
  type NativeConfigValue,
} from '../core';

export const OH_MY_OPENAGENT_SCHEMA_URL = 'https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json';

export class OhMyOpenAgentAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OhMyOpenAgentAdapterError';
  }
}

export type ResolveOhMyOpenAgentConfigPathOptions = {
  configPath?: string;
  env?: Pick<NodeJS.ProcessEnv, 'OH_MY_OPENAGENT_CONFIG_PATH'>;
};

type AssignmentGroup = 'agents' | 'categories';
type AssignmentField = 'model' | 'variant';

const ASSIGNMENT_FIELDS = ['model', 'variant'] as const;

export function resolveOhMyOpenAgentConfigPath(options: ResolveOhMyOpenAgentConfigPathOptions = {}): string {
  return options.configPath ?? options.env?.OH_MY_OPENAGENT_CONFIG_PATH ?? join(homedir(), '.config', 'opencode', 'oh-my-openagent.json');
}

export function renderOhMyOpenAgentConfigText(config: CanonicalAgentConfig, existingConfigText: string): string {
  return serializeNativeConfig(renderOhMyOpenAgentConfigObject(config, parseOhMyOpenAgentConfig(existingConfigText)), 'json');
}

export function renderOhMyOpenAgentConfigObject(
  config: CanonicalAgentConfig,
  existingConfig: NativeConfigObject = {},
): NativeConfigObject {
  const rendered = cloneNativeConfigObject(existingConfig);
  if (rendered.$schema === undefined) {
    rendered.$schema = OH_MY_OPENAGENT_SCHEMA_URL;
  }

  syncAssignments(rendered, 'agents', OH_MY_OPENAGENT_AGENT_NAMES, config.ohMyOpenAgent?.agents);
  syncAssignments(rendered, 'categories', OH_MY_OPENAGENT_CATEGORY_NAMES, config.ohMyOpenAgent?.categories);

  return rendered;
}

export function diffOhMyOpenAgentConfigObject(
  config: CanonicalAgentConfig,
  existingConfig: NativeConfigObject,
): ManagedDiffChange[] {
  const expected = renderOhMyOpenAgentConfigObject(config, existingConfig);
  return [
    ...diffAssignments('agents', OH_MY_OPENAGENT_AGENT_NAMES, existingConfig, expected),
    ...diffAssignments('categories', OH_MY_OPENAGENT_CATEGORY_NAMES, existingConfig, expected),
  ];
}

function parseOhMyOpenAgentConfig(content: string): NativeConfigObject {
  const parsed = parseNativeConfig(content, 'json');
  if (!isNativeConfigObject(parsed)) {
    throw new OhMyOpenAgentAdapterError('OhMyOpenAgent config must be a JSON object at the top level');
  }
  return parsed;
}

function syncAssignments(
  config: NativeConfigObject,
  group: AssignmentGroup,
  allowedNames: readonly string[],
  expectedAssignments: Record<string, { model: string; variant?: string }> | undefined,
): void {
  const existingGroup = config[group];
  if (existingGroup === undefined && expectedAssignments === undefined) {
    return;
  }

  const groupConfig = ensureGroupObject(config, group);

  for (const name of allowedNames) {
    const expectedAssignment = expectedAssignments?.[name];
    syncAssignment(groupConfig, group, name, expectedAssignment);
  }

  if (Object.keys(groupConfig).length === 0) {
    delete config[group];
  }
}

function syncAssignment(
  groupConfig: NativeConfigObject,
  group: AssignmentGroup,
  name: string,
  expectedAssignment: { model: string; variant?: string } | undefined,
): void {
  const existingAssignment = groupConfig[name];
  if (expectedAssignment === undefined) {
    removeManagedAssignmentFields(groupConfig, group, name, existingAssignment);
    return;
  }

  const assignmentConfig = existingAssignment === undefined ? {} : assertAssignmentObject(existingAssignment, group, name);
  assignmentConfig.model = expectedAssignment.model;

  if (expectedAssignment.variant === undefined) {
    delete assignmentConfig.variant;
  } else {
    assignmentConfig.variant = expectedAssignment.variant;
  }

  groupConfig[name] = assignmentConfig;
}

function removeManagedAssignmentFields(
  groupConfig: NativeConfigObject,
  group: AssignmentGroup,
  name: string,
  existingAssignment: NativeConfigValue | undefined,
): void {
  if (existingAssignment === undefined) {
    return;
  }

  const assignmentConfig = assertAssignmentObject(existingAssignment, group, name);
  delete assignmentConfig.model;
  delete assignmentConfig.variant;

  if (Object.keys(assignmentConfig).length === 0) {
    delete groupConfig[name];
    return;
  }

  groupConfig[name] = assignmentConfig;
}

function diffAssignments(
  group: AssignmentGroup,
  names: readonly string[],
  currentConfig: NativeConfigObject,
  expectedConfig: NativeConfigObject,
): ManagedDiffChange[] {
  const changes: ManagedDiffChange[] = [];
  const currentGroup = optionalGroupObject(currentConfig, group);
  const expectedGroup = optionalGroupObject(expectedConfig, group);

  for (const name of names) {
    const currentAssignment = optionalAssignmentObject(currentGroup, group, name);
    const expectedAssignment = optionalAssignmentObject(expectedGroup, group, name);

    for (const field of ASSIGNMENT_FIELDS) {
      const currentValue = optionalAssignmentString(currentAssignment, field, group, name);
      const expectedValue = optionalAssignmentString(expectedAssignment, field, group, name);
      if (currentValue === expectedValue) {
        continue;
      }
      changes.push({
        field: `ohMyOpenAgent.${group}.${name}.${field}`,
        current: currentValue,
        expected: expectedValue,
        secret: false,
      });
    }
  }

  return changes;
}

function ensureGroupObject(config: NativeConfigObject, group: AssignmentGroup): NativeConfigObject {
  const existingGroup = config[group];
  if (existingGroup === undefined) {
    const created: NativeConfigObject = {};
    config[group] = created;
    return created;
  }
  if (!isNativeConfigObject(existingGroup)) {
    throw new OhMyOpenAgentAdapterError(`OhMyOpenAgent ${group} must be an object before rendering managed routes`);
  }
  return existingGroup;
}

function optionalGroupObject(config: NativeConfigObject, group: AssignmentGroup): NativeConfigObject | undefined {
  const existingGroup = config[group];
  if (existingGroup === undefined) {
    return undefined;
  }
  if (!isNativeConfigObject(existingGroup)) {
    throw new OhMyOpenAgentAdapterError(`OhMyOpenAgent ${group} must be an object before diffing managed routes`);
  }
  return existingGroup;
}

function assertAssignmentObject(value: NativeConfigValue, group: AssignmentGroup, name: string): NativeConfigObject {
  if (!isNativeConfigObject(value)) {
    throw new OhMyOpenAgentAdapterError(`OhMyOpenAgent ${group}.${name} must be an object before rendering managed routes`);
  }
  return value;
}

function optionalAssignmentObject(
  groupConfig: NativeConfigObject | undefined,
  group: AssignmentGroup,
  name: string,
): NativeConfigObject | undefined {
  const assignment = groupConfig?.[name];
  if (assignment === undefined) {
    return undefined;
  }
  if (!isNativeConfigObject(assignment)) {
    throw new OhMyOpenAgentAdapterError(`OhMyOpenAgent ${group}.${name} must be an object before diffing managed routes`);
  }
  return assignment;
}

function optionalAssignmentString(
  assignment: NativeConfigObject | undefined,
  field: AssignmentField,
  group: AssignmentGroup,
  name: string,
): string | undefined {
  const value = assignment?.[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new OhMyOpenAgentAdapterError(`OhMyOpenAgent ${group}.${name}.${field} must be a string before diffing managed routes`);
  }
  return value;
}

function cloneNativeConfigObject(value: NativeConfigObject): NativeConfigObject {
  const cloned = cloneNativeConfigValue(value);
  if (!isNativeConfigObject(cloned)) {
    throw new OhMyOpenAgentAdapterError('Cloned OhMyOpenAgent config must be an object');
  }
  return cloned;
}

function cloneNativeConfigValue(value: NativeConfigValue): NativeConfigValue {
  if (Array.isArray(value)) {
    return value.map(cloneNativeConfigValue);
  }
  if (isNativeConfigObject(value)) {
    const cloned: NativeConfigObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      cloned[key] = cloneNativeConfigValue(nestedValue);
    }
    return cloned;
  }
  return value;
}

function isNativeConfigObject(value: NativeConfigValue | undefined): value is NativeConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
