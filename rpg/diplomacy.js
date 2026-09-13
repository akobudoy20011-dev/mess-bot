const db = require("../db");
const { getKingdom, listKingdoms } = require("./kingdoms");

const VALID_STATUSES = ["neutral", "friendly", "allied", "hostile", "at_war"];

function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function getRelation(threadID, kingdomA, kingdomB) {
  const [first, second] = orderedPair(kingdomA, kingdomB);
  const result = await db.query(
    `SELECT * FROM rpg_diplomacy WHERE thread_id = $1 AND kingdom_a = $2 AND kingdom_b = $3`,
    [String(threadID), first, second]
  );
  return result.rows[0]?.status || "neutral";
}

async function setRelation(threadID, kingdomA, kingdomB, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid diplomatic status: ${status}`);
  }

  const [first, second] = orderedPair(kingdomA, kingdomB);
  await db.query(
    `
    INSERT INTO rpg_diplomacy (thread_id, kingdom_a, kingdom_b, status, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (thread_id, kingdom_a, kingdom_b)
    DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
    `,
    [String(threadID), first, second, status, Date.now()]
  );

  return status;
}

async function getAllRelations(threadID, kingdomId) {
  const others = (await listKingdoms(threadID)).filter((k) => k.kingdom_id !== kingdomId);
  const relations = [];

  for (const other of others) {
    const status = await getRelation(threadID, kingdomId, other.kingdom_id);
    relations.push({ kingdom: other, status });
  }

  return relations;
}

async function declareWar(threadID, kingdomA, kingdomB) {
  const a = await getKingdom(threadID, kingdomA);
  const b = await getKingdom(threadID, kingdomB);
  if (!a || !b) throw new Error("Both kingdoms must exist to declare war.");

  const current = await getRelation(threadID, a.kingdom_id, b.kingdom_id);
  if (current === "at_war") {
    throw new Error(`${a.name} and ${b.name} are already at war.`);
  }

  await setRelation(threadID, a.kingdom_id, b.kingdom_id, "at_war");
  return { attacker: a, defender: b };
}

async function offerPeace(threadID, kingdomA, kingdomB) {
  const a = await getKingdom(threadID, kingdomA);
  const b = await getKingdom(threadID, kingdomB);
  if (!a || !b) throw new Error("Both kingdoms must exist to negotiate peace.");

  const current = await getRelation(threadID, a.kingdom_id, b.kingdom_id);
  if (current !== "at_war") {
    throw new Error(`${a.name} and ${b.name} are not at war.`);
  }

  // Deterministic acceptance: more stable, wealthier kingdoms are like ier to accept peace.
  const acceptChance = Math.min(90, 30 + Number(b.stability) * 0.5);
  const accepted = Math.random() * 100 < acceptChance;

  if (accepted) {
    await setRelation(threadID, a.kingdom_id, b.kingdom_id, "neutral");
  }

  return { accepted, kingdomA: a, kingdomB: b };
}

module.exports = {
  VALID_STATUSES,
  declareWar,
  getAllRelations,
  getRelation,
  offerPeace,
  setRelation,
};
