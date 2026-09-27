const fs = require("node:fs");
const path = require("node:path");

const project = "agendae-prod";
const email = "barbeariadorenam-admin@agendae.com.br";
const slug = "barbeariadorenam";
const apply = process.argv.includes("--apply");

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
    if (!response.ok) throw new Error(`A operação administrativa falhou: HTTP ${response.status}.`);
    return response.json();
  }

  const lookup = await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, {
    method: "POST", body: JSON.stringify({ email: [email] }),
  });
  const user = lookup.users?.find(item => item.email === email);
  if (!user || user.disabled) throw new Error("A conta admin não existe ou está desativada.");
  const root = `projects/${project}/databases/(default)/documents`;
  const endpoint = `https://firestore.googleapis.com/v1/${root}`;
  await request(`${endpoint}/establishments/${slug}`);
  const profileName = `${root}/users/${user.localId}`;
  const profileUrl = `${endpoint}/users/${user.localId}`;
  const existing = await request(profileUrl, {}, true);
  if (existing) {
    if (existing.fields?.establishmentSlug?.stringValue !== slug) {
      throw new Error("A conta já possui vínculo com outro estabelecimento; nenhum dado foi alterado.");
    }
    console.log(JSON.stringify({ status: "already-linked", email, uid: user.localId, slug }));
    return;
  }
  if (!apply) {
    console.log(JSON.stringify({ status: "profile-missing", email, uid: user.localId, slug }));
    return;
  }
  await request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`, {
    method: "POST",
    body: JSON.stringify({ writes: [{
      update: { name: profileName, fields: {
        name: { stringValue: "Administrador" },
        email: { stringValue: email },
        role: { stringValue: "admin" },
        establishmentSlug: { stringValue: slug },
      } },
      currentDocument: { exists: false },
      updateTransforms: ["createdAt", "updatedAt"].map(fieldPath => ({ fieldPath, setToServerValue: "REQUEST_TIME" })),
    }] }),
  });
  const verified = await request(profileUrl);
  if (verified.fields?.establishmentSlug?.stringValue !== slug || verified.fields?.role?.stringValue !== "admin") {
    throw new Error("Não foi possível confirmar o vínculo criado.");
  }
  console.log(JSON.stringify({ status: "profile-created-and-verified", email, uid: user.localId, slug }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
