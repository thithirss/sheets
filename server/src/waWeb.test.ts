import assert from "node:assert/strict";
import test from "node:test";
import { parseExpenseInput, parseMenuChoice } from "./waText.js";

test("parseMenuChoice reconhece números e palavras", () => {
  assert.equal(parseMenuChoice("1"), 1);
  assert.equal(parseMenuChoice('"1"'), 1);
  assert.equal(parseMenuChoice("1️⃣"), 1);
  assert.equal(parseMenuChoice("um"), 1);
  assert.equal(parseMenuChoice("três"), 3);
  assert.equal(parseMenuChoice("0"), 0);
  assert.equal(parseMenuChoice("08/02"), null);
  assert.equal(parseMenuChoice("45,90 almoço"), null);
});

test("parseExpenseInput parseia valor, descrição, data e categoria", () => {
  const parsed = parseExpenseInput("GASTO 10,50 Café #alimentacao 2026-02-08");
  assert.ok(parsed);
  assert.equal(parsed.amount, 10.5);
  assert.equal(parsed.description, "Café");
  assert.equal(parsed.dateISO, "2026-02-08");
  assert.equal(parsed.category, "Alimentação");
});
