const fs = require("node:fs");
const path = require("node:path");

const project = "agendae-prod";
const email = String(process.argv[2] || "").trim().toLowerCase();
const apply = process.argv.includes("--apply");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Uso: node scripts/link-system-admin.cjs EMAIL [--apply]");
  process.exit(1);
}

async function main() {
  const cache = path.join(process.env.LOCALAPPDATA, "npm-cache", "_npx");
  const cliRoot = fs.readdirSync(cache).map(entry => path.join(cache, entry, "node_modules", "firebase-tools", "lib"))
    .find(directory => fs.existsSync(path.join(directory, "auth.js")));
  if (!cliRoot) throw new Error("Firebase CLI não encontrado no cache do npm.");
  const auth = require(path.join(cliRoot, "auth.js"));
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Execute firebase login com uma conta administrativa.");
  const tokens = await auth.getAccessToken(account.tokens.refresh_token, [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/firebase",
  ]);
  async function request(url, options = {}, allowMissing = false) {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" },
    });
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok) throw new Error(`Operação administrativa falhou: HTTP ${response.status}.`);
    return response.json();
  }
  const lookup = await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, {
    method: "POST", body: JSON.stringify({ email: [email] }),
  });
  const user = lookup.users?.find(item => item.email?.toLowerCase() === email);
  if (!user || user.disabled) throw new Error("A conta não existe no Firebase Authentication ou está desativada.");
  const root = `projects/${project}/databases/(default)/documents`;
  const endpoint = `https://firestore.googleapis.com/v1/${root}`;
  const existing = await request(`${endpoint}/systemAdmins/${user.localId}`, {}, true);
  if (existing) {
    if (existing.fields?.active?.booleanValue !== true) throw new Error("O vínculo existe, mas não está ativo.");
    console.log(JSON.stringify({ status: "already-linked", email, uid: user.localId }));
    return;
  }
  if (!apply) {
    console.log(JSON.stringify({ status: "link-missing", email, uid: user.localId }));
    return;
  }
  await request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`, {
    method: "POST",
    body: JSON.stringify({ writes: [{
      update: { name: `${root}/systemAdmins/${user.localId}`, fields: {
        name: { stringValue: "Administrador do sistema" },
        active: { booleanValue: true },
      } },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
    }] }),
  });
  const verified = await request(`${endpoint}/systemAdmins/${user.localId}`);
  if (verified.fields?.active?.booleanValue !== true) throw new Error("Não foi possível confirmar o vínculo do administrador do sistema.");
  console.log(JSON.stringify({ status: "linked-and-verified", email, uid: user.localId }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
