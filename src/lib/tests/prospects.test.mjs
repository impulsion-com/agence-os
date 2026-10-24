// Prospection : lecture d'un export gosom/google-maps-scraper et nettoyage des emails.
// node --experimental-strip-types --test src/lib/tests/prospects.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsv } from "../csv-grid.ts";
import { bestEmail, cleanEmails, normalizeProspect, parseProspectsGrid, prospectKey } from "../prospects-parse.ts";

// Extrait au format exact de gosom v1.18 (colonnes réduites aux utiles, mêmes en-têtes)
const GOSOM = [
  "input_id,link,title,category,address,website,phone,review_count,review_rating,latitude,longitude,cid,status,descriptions,place_id,complete_address,emails",
  `a1,https://www.google.com/maps/place/Agence+Nova,Agence Nova,Agence de publicité,"12 rue de la Paix, 33000 Bordeaux",https://nova.fr/,+33 5 56 00 00 00,43,4.900000,44.84,-0.57,111,,"Une agence ""créative""
sur deux lignes",ChIJnova,"{""street"":""12 rue de la Paix"",""city"":""Bordeaux"",""postal_code"":""33000"",""country"":""France""}","job@nova.fr, contact@nova.fr"`,
  `a1,https://www.google.com/maps/place/Root,ELNCOM (Root),Agence de publicité,,http://www.elncom.fr/,,24,5.000000,44.97,0.40,222,,,ChIJroot,"{""street"":"""",""city"":"""",""postal_code"":"""",""country"":""""}","Twins@2x.png.webp, Twins@2x-400x250.png, logo@3x.jpg"`,
  `a1,https://www.google.com/maps/place/Ferme,Vieille Agence,Agence de publicité,,,,3,3.000000,44.8,-0.5,333,Fermé définitivement,,ChIJferme,{},`,
  `a1,,,Sans nom,,,,,,,,444,,,,{},`,
].join("\n");

test("parseCsv garde les cellules avec virgules, guillemets et retours à la ligne", () => {
  const g = parseCsv(GOSOM);
  assert.equal(g.length, 5);
  assert.equal(g[1].length, g[0].length);
  assert.match(g[1][13], /créative"\nsur deux/);
});

test("export gosom : colonnes, adresse complète, fiches fermées et sans nom", () => {
  const r = parseProspectsGrid(parseCsv(GOSOM), "agence publicité Bordeaux");
  assert.equal(r.rows.length, 2);
  assert.equal(r.closed, 1);
  assert.equal(r.empty, 1);
  const [nova, root] = r.rows;
  assert.equal(nova.name, "Agence Nova");
  assert.equal(nova.external_id, "ChIJnova");
  assert.equal(nova.city, "Bordeaux");
  assert.equal(nova.postal_code, "33000");
  assert.equal(nova.rating, 4.9);
  assert.equal(nova.reviews, 43);
  assert.equal(nova.search, "agence publicité Bordeaux");
  assert.deepEqual(nova.emails, ["job@nova.fr", "contact@nova.fr"]);
  assert.equal(bestEmail(nova.emails), "contact@nova.fr");
  assert.deepEqual(root.emails, []);
  assert.equal(root.city, "");
});

test("autre outil : en-têtes français et séparateur point-virgule", () => {
  const r = parseProspectsGrid(parseCsv("Nom;Ville;Code postal;Téléphone;Email;Note;Avis\nBoulangerie Dupont;Lyon;69003;04 78 00 00 00;Bonjour@Dupont.fr;4,6;120"));
  assert.equal(r.rows.length, 1);
  assert.deepEqual(
    { name: r.rows[0].name, city: r.rows[0].city, pc: r.rows[0].postal_code, emails: r.rows[0].emails, rating: r.rows[0].rating, reviews: r.rows[0].reviews },
    { name: "Boulangerie Dupont", city: "Lyon", pc: "69003", emails: ["bonjour@dupont.fr"], rating: 4.6, reviews: 120 },
  );
});

test("sans colonne nom, rien n'est lu", () => {
  const r = parseProspectsGrid(parseCsv("email,phone\na@b.fr,0102030405"));
  assert.equal(r.rows.length, 0);
  assert.ok(!r.recognized.includes("name"));
});

test("cleanEmails écarte images, domaines techniques et doublons", () => {
  assert.deepEqual(cleanEmails("mailto:Hello@Site.fr; hello@site.fr, x@sentry.io, a@o-1.sentry.io, img@2x.png, test@example.com, <rh@site.fr>"), ["hello@site.fr", "rh@site.fr"]);
  assert.deepEqual(cleanEmails(["a@b.fr", "pas un email"]), ["a@b.fr"]);
});

test("bestEmail préfère une adresse commerciale, sinon garde la seule disponible", () => {
  assert.equal(bestEmail(["noreply@a.fr", "recrutement@a.fr", "benjamin@a.fr"]), "benjamin@a.fr");
  assert.equal(bestEmail(["job@a.fr"]), "job@a.fr");
  assert.equal(bestEmail([]), "");
});

test("normalizeProspect borne les valeurs et complète les sites sans protocole", () => {
  const p = normalizeProspect({ name: "  X  ", rating: 7, reviews: -3, website: "x.fr", maps_url: "javascript:alert(1)", latitude: 120 });
  assert.equal(p.name, "X");
  assert.equal(p.rating, 5);
  assert.equal(p.reviews, 0);
  assert.equal(p.website, "https://x.fr");
  assert.equal(p.maps_url, "");
  assert.equal(p.latitude, null);
  assert.equal(normalizeProspect({ name: "   " }), null);
});

test("prospectKey : identifiant Google, sinon nom et code postal sans accents ni casse", () => {
  assert.equal(prospectKey({ source: "google_maps", external_id: "ChIJ1", name: "A", postal_code: "", address: "" }), "google_maps:ChIJ1");
  assert.equal(
    prospectKey({ source: "google_maps", external_id: "", name: "Café Élan", postal_code: "69003", address: "" }),
    prospectKey({ source: "google_maps", external_id: "", name: "CAFE ELAN", postal_code: "69003", address: "x" }),
  );
});
