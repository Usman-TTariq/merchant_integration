import "dotenv/config";

const SKU = process.env.TEST_SKU ?? "A38573";

async function refreshToken() {
  const res = await fetch("https://public-api.shiphero.com/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: process.env.SHIPHERO_REFRESH_TOKEN }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("Refresh failed:", res.status, json);
    process.exit(1);
  }
  return json.access_token;
}

async function graphql(token, query, variables) {
  const res = await fetch("https://public-api.shiphero.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

const token = await refreshToken();
console.log("Refresh OK\n");

const productQuery = `query ProductBySku($sku: String!) {
  product(sku: $sku) { data { sku warehouse_products { warehouse_id on_hand } } }
}`;

const read = await graphql(token, productQuery, { sku: SKU });
console.log("=== Product read ===");
console.log(JSON.stringify(read.json, null, 2));

const warehouseId = process.env.SHIPHERO_WAREHOUSE_ID;
const addMutation = `mutation InventoryAdd($data: UpdateInventoryInput!) {
  inventory_add(data: $data) { request_id }
}`;

console.log("\n=== inventory_add (qty 1) ===");
const add = await graphql(token, addMutation, {
  data: {
    sku: SKU,
    warehouse_id: warehouseId,
    quantity: 1,
    reason: "Delta sync smoke test - add",
  },
});
console.log(JSON.stringify(add.json, null, 2));

const removeMutation = `mutation InventoryRemove($data: UpdateInventoryInput!) {
  inventory_remove(data: $data) { request_id }
}`;

console.log("\n=== inventory_remove (qty 1) ===");
const remove = await graphql(token, removeMutation, {
  data: {
    sku: SKU,
    warehouse_id: warehouseId,
    quantity: 1,
    reason: "Delta sync smoke test - remove",
  },
});
console.log(JSON.stringify(remove.json, null, 2));

console.log("\n=== inventory_replace (expected slotting block) ===");
const replaceMutation = `mutation InventoryReplace($data: ReplaceInventoryInput!) {
  inventory_replace(data: $data) { request_id }
}`;
const replace = await graphql(token, replaceMutation, {
  data: {
    sku: SKU,
    warehouse_id: warehouseId,
    quantity: 9,
    reason: "Replace smoke test",
  },
});
console.log(JSON.stringify(replace.json, null, 2));

const addOk = add.json.data?.inventory_add?.request_id && !add.json.errors?.length;
const removeOk =
  remove.json.data?.inventory_remove?.request_id && !remove.json.errors?.length;
const replaceBlocked = replace.json.errors?.some((e) =>
  String(e.message).toLowerCase().includes("dynamic slotting")
);

console.log("\n=== Summary ===");
console.log(`inventory_add:    ${addOk ? "OK" : "FAILED"}`);
console.log(`inventory_remove: ${removeOk ? "OK" : "FAILED"}`);
console.log(`inventory_replace blocked (expected): ${replaceBlocked ? "yes" : "no"}`);

if (!addOk || !removeOk) process.exit(1);
