# Bhai, update ka short tareeqa

1. **Pehle Supabase backup lein.** SQL Editor mein `supabase/schema.sql` ka poora code ek baar run karein. Is mein cancellation aur salary-safety upgrades included hain; records bulk-delete nahi hote. Isi file ko run karne ke baad migrations alag se run karna zaroori nahi.
2. Apne admin email ka profile `role = 'admin'` confirm karein — exact SQL README mein hai.
3. ZIP extract karke **andar ki files/folders** apni GitHub repository mein upload karein, ZIP file khud nahi. Apne private keys upload na karein.
4. Cloudflare secrets/public build variables pehle ki tarah set hon. Build: `npm ci --legacy-peer-deps && npx @opennextjs/cloudflare build`; deploy: `npx wrangler deploy`.
5. Test accounts par paid/unpaid/short leave, cancellation, QR rotation, GPS, login/device approvals aur salary preview verify karein. Uske baad hi real salary approve karein.

**Sirf GitHub upload se database update khud nahi hota.** Step 1 skip karne par nayi payroll/cancellation APIs safely error dengi, incomplete salary report nahi banayengi.

**Salary policy:** monthly base se sirf approved Unpaid aur Short Leave deduct hoti hai; unmarked attendance ko apne aap unpaid nahi banaya gaya. Company policy confirm karein. Historical salary/rate changes ko automatically prorate nahi kiya gaya; known ambiguity par REVIEW REQUIRED aur PDF hold aayega. Purane records se manual reconciliation zaroori ho sakti hai.

Detailed setup/policies: `README.md`. Tests aur limitations: `TEST_REPORT.md`.
