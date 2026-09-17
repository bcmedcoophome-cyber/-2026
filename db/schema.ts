import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cognitiveChecks = sqliteTable('cognitive_checks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  score: integer('score').notNull(),
  riskKey: text('risk_key').notNull(),
  answersJson: text('answers_json').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_cognitive_checks_device_created').on(table.deviceId, table.createdAt),
]);

export const chronicRecords = sqliteTable('chronic_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  age: integer('age').notNull(),
  systolic: integer('systolic').notNull(),
  diastolic: integer('diastolic').notNull(),
  bloodSugar: integer('blood_sugar').notNull(),
  sugarTiming: text('sugar_timing').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_chronic_records_device_created').on(table.deviceId, table.createdAt),
]);
