# MDM Request Hub · Lives Group

A working prototype for Lives Group. One request form for new customers, items, vendors and cost centres, with parallel approvals in Teams and Outlook, a live status page and an import file for SAP Business One. The same clean records feed a regional sales view: purchase orders for Products A, B and C across Singapore, Malaysia, Indonesia, Thailand and Vietnam, with a forecast that is measurably better than today's spreadsheet average.

| | |
|---|---|
| **Live prototype** | https://luochuan91.github.io/lives-mdm-hub/ |
| **Demo video** | `https://youtu.be/FZe3zLYYH1M` |
| **Sign in** | Any demo account, password `Lives2026!` (see [Sign-in and roles](#sign-in-and-roles)) |
| **Repository** | https://github.com/LuoChuan91/lives-mdm-hub |

![Home page: email process 18.0 days, request hub 3.0 days](docs/img/home.png)

All data is synthetic and generated with a fixed seed. Apart from National University Hospital, which the case brief itself uses as its example, every name, registration number, bank detail and volume is invented.

---

## The problem

Master data requests travel by email. A request is missing a field, so it bounces back, approvers review one after another; nobody can see where a request stands, and the MDM team keys every record into SAP B1 by hand, relying on memory to spot near-duplicates. On our synthetic history of 354 requests, a request took **18.0 days on average** (median 16.4, one in ten took more than 28.8 days), and 38% bounced back at least once for missing information.

The same duplicates then distort the sales view. A customer recorded twice looks like a new account, the "old" record looks like a customer that stopped ordering, and a Johor hospital filed under Singapore puts Malaysian orders in the Singapore numbers.

## What the prototype does

| Page | Who uses it | What it shows |
|---|---|---|
| **New request** | Requesters (Amy, Marcus, Nurul) | Fields change with the request type (a licence number appears only for regulated items); the duplicate check runs as you type, including initials such as "Natl Univ Hosp" and pack-size variants; the approvers are worked out from rules before you submit. |
| **My approvals** | Approvers (Wei Jie, Dr Siti, Daniel and others) | Teams-style cards with the facts each approver checks. Approve, ask for information or reject. Bank details stay masked until the approver chooses to see them, and that view is logged. |
| **Request tracker** | Everyone | Where every request stands, who it is waiting on, overdue reminders, full history. |
| **MDM desk** | The MDM team (Priya) | Final duplicate check, SAP code assignment, the Data Transfer Workbench import file, master data health (existing duplicates) and an append-only audit log. |
| **Settings** | The MDM team | Business units, form fields, approval rules and service levels are data, not code. Adding Marcus's new business unit takes a minute and needs no IT change. |
| **Regional view** | Sales and management | Volume and growth by country and product, the forecast and its backtest, where the growth came from, orders kept apart from enquiries and setup requests, signals for sales, recommended actions, and what merging duplicates changes. |
| **Market scenarios** | Sales, finance and management | What a weaker local currency, a new import tariff or tighter hospital budgets would do to next quarter's orders, by country, product line and customer. Every price sensitivity is a stated assumption you can change on the page. Also shows the test of a purchase-likelihood model. |
| **Inbox sorting** | Order desk, MDM team | A small text model sorts shared-mailbox emails into purchase orders, enquiries, setup requests and follow-ups, and pulls out the PO number, quantity and item. |
| **Business case** | Management | Turnaround model with sliders, hours saved, build cost, payback, alternatives, adoption plan and the Microsoft 365 production design. |

You sign in as one of the people in the case (the login page lists a demo account for each; see [Sign-in and roles](#sign-in-and-roles)), and the account decides what you see: requesters get the request form, approvers their own approvals, the MDM team the desk and Settings. A simulated clock moves to the next working day to show reminders and escalations, and **Reset demo** starts again. Requests and the clock are shared by every account in the same browser, so a request Amy submits is waiting when Wei Jie signs in.


### Demo video

The video follows one request through each person's account (sign-in details are under [Sign-in and roles](#sign-in-and-roles)):

1. **Amy** asks for a new reagent kit. The form flags the existing 100-test pack as a possible duplicate; she explains why hers is different and sees who will approve it and when it will be live.
2. **Marcus** types "Natl Univ Hosp". The form shows that National University Hospital already exists, before any approver sees the request.
3. **Wei Jie** sees what is waiting for him. Bank details stay masked until he clicks *Show*, and that view is logged; he approves a new customer from a Teams-style card.
4. **Next working day.** Overdue approvals get a reminder, then an escalation.
5. **Priya** adds Marcus's new business unit in Settings; his requests now route to its head.
6. **Priya** passes the customer Wei Jie approved through the final check, and it goes into the SAP B1 import file.
7. **Regional view**: the records as they are in SAP B1 today against duplicates merged, then growth by country and product and the forecast error.
8. **Market scenarios**: *All three at once* shows which countries, product lines and customers a weaker currency, an instrument tariff and slower hospital spending would hit.
9. **Business case**: build cost, payback and how people move off email.

## Sign-in and roles

Every demo account uses the password **`Lives2026!`**. The login page lists them too: click a person to fill in the form.

| Person | Username | Role on the login page | Can do |
|---|---|---|---|
| Amy | `amy` | Requester · SPD | Create requests (item, customer, vendor, cost centre) |
| Marcus | `marcus` | Requester · new business unit | Create requests; his business unit is not set up yet |
| Wei Jie | `weijie` | Finance approver | Approve credit terms, vendor bank details and cost centres |
| Dr Siti | `siti` | Quality & Regulatory approver | Approve regulated items and principals' quality agreements |
| Daniel | `daniel` | Business Unit Head · SPD | Approve SPD customers, items and cost centres |
| Grace | `grace` | Business Support approver | Approve item pricing and public-hospital tender checks |
| Hafiz | `hafiz` | Procurement approver | Evaluate new vendors |
| Priya | `priya` | MDM administrator | MDM desk, SAP import file, Settings |

There is also `testuser` / `TestUser123!` (Requester · SPD). You can create more accounts on the *Create account* tab; each role maps to the person above, so accounts in the same role share that person's approvals.

Requesters create requests, approvers act on their own steps, and only the MDM team opens the MDM desk and Settings; everyone can track requests and use the insight pages. Requests, the simulated clock and the audit log live in the browser's local storage, shared by the accounts in that browser but not between browsers. This is a prototype: the demo passwords are public on purpose, and role restrictions run in the browser. In production, sign-in and permissions would come from Microsoft 365.

## Results on the synthetic data

| Measure | Today | With the hub | How we got it |
|---|---|---|---|
| Request turnaround (average) | 18.0 days | **3.0 days** (9 in 10 within 4.7 days) | Monte Carlo model of 20,000 simulated requests, calibrated to 12 months of email-era history |
| Forecast error, 1 to 3 months ahead (WAPE) | 17.1% (6-month average, under-forecasts by 13%) | **11.7%** | Rolling-origin backtest, March to June 2026 origins, value-weighted |
| Duplicate customers found | n/a | **10 of 10**, no false merges | Planted duplicates with ground truth in `data/planted_patterns.json` |
| Mailbox messages sorted correctly | manual | **96.7%** on 902 unseen emails | TF-IDF + logistic regression; 96% sorted without a person at ≥ 80% confidence (97.6% correct) |
| Staff time saved | | **≈ 765 hours a year** (≈ 0.5 full-time staff, ≈ SGD 42k) | Minutes per request before and after, all adjustable on the Business case page |
| Build cost and payback | | **≈ SGD 20.6k**, pays back in **≈ 6 months** | 156 internal hours plus 10 days of outside help; Microsoft 365 licences assumed in place |

What the regional view finds (July to September 2026 against April to June 2026):

- **Indonesia adds the most new business.** Quarterly orders are worth about SGD 700k more than a year ago, more than any other country; Product A is up 12% and Product B up 11% this quarter; six Indonesian hospitals opened accounts this year and five more are waiting on setup. *Action: fast-track Indonesian setups and plan extra A and B stock for Q4.*
- **Vietnam grew fastest this quarter, but its instrument growth rests on three hospitals.** Order value is up 20%; Product C is up 52%, all of it from three accounts. *Action: win more instrument accounts before planning on this continuing.*
- **Thailand lab consumables are falling.** Product B down 11%; Pattaya Bay Hospital (about SGD 48k a month) has not ordered since 29 June. *Action: account manager call this week.*
- **17 hospitals buy reagents and consumables but no instruments**, while most similar hospitals buy all three (about SGD 57k a month of potential). *Action: hand the list to the instruments team for Q4 visits.*
- **Duplicates distort the customer view.** Before merging, 2 of 5 "going quiet" alerts were false, 3 of 4 "new accounts" were existing customers, and 2,887 boxes of Malaysian Product B orders were counted in Singapore.

- **Currency moves matter more than an instrument tariff.** A weaker currency touches every product line, and by default half of the move comes straight off Lives Group's Singapore-dollar revenue before a single order is lost; a tariff is mostly passed on, and only instruments react much. *Action: agree price-review triggers with finance for Indonesia and Vietnam, where volume is growing fastest.*
- **Instruments are the exposed line.** Reagents are needed for every test, so their orders barely move; a hospital can postpone an analyser. *Action: in a tariff or currency shock, offer instrument leasing or staged payments before customers defer.*
- **The page lists the customers most exposed**, so account managers know whom to call first.

## Diagrams

The to-be process flow and the ER diagram are in [`docs/diagrams/`](docs/diagrams).

![To-be process flow](docs/diagrams/to_be_flow.png)

![Entity-relationship diagram](docs/diagrams/erd.png)

## How the prototype works

**One engine, two languages.** The analysis runs in Python (`analysis/`) and writes every number the app shows into `assets/data.js`. The parts that must run live in the browser (duplicate matching, the inbox classifier, the workflow and the turnaround model) are written again in JavaScript (`assets/engine.js`). Tests check that the two agree: the same duplicate scores within 0.15 points and the same classifier probabilities within 0.002.

**Duplicate matching** (`analysis/dedup.py`, shared rules in `analysis/textnorm.json`). Names are normalised (legal suffixes such as Sdn Bhd, PT and Co., Ltd. removed; abbreviations such as Hosp, Univ and Natl expanded; initials such as NUH recognised), then compared with an edit-distance ratio that weighs distinctive words above generic ones such as "hospital" or "clinic". Matching registration numbers, phone numbers, addresses, email domains and bank accounts raise the score; a different country, city or facility type lowers it. Scores of 90 and above are *likely* duplicates; 75 to 89 are *possible* and go to a person. Items also check pack sizes, variants (glove sizes, EDTA versus serum tubes) and manufacturer part numbers.

**Forecasting** (`analysis/forecasting.py`). Twelve months of history is too short for seasonality or machine learning, so the method is deliberately simple and explainable: a damped-trend model for each country and product, averaged with a regional model split by each country's recent share. Intermittent series use Croston's method. We hid each month from March to June 2026, forecast one to three months ahead from the months before it, and compared with what customers actually ordered. Repeating last month scores about the same (11.4%) but its forecast swings 15% from month to month against 7% for the combined method, so stock plans built on it would lurch.

**Growth measure.** Units ordered in July to September 2026 divided by units ordered in April to June 2026, minus one (quarter on quarter). Year-on-year growth would need more than 12 months of history. Only customer purchase orders count as volume; enquiries, setup requests and follow-ups are counted separately.

**Turnaround model** (`analysis/process_sim.py`). Today: triage, a 40% chance of bouncing back for missing fields, approvals one after another, possible clarification rounds and manual keying. With the hub: required fields enforced, approvals in parallel, a reminder at the service level and an escalation one working day later. The sliders on the Business case page re-run the same model in the browser.

**Market scenarios** (`marketScenario` in `assets/engine.js`, inputs from `analysis/build_data.py`). The October to December forecast is split by customer using each customer's July to September orders. A weaker local currency raises the local price by the share of the move Lives Group passes on (default 50%; the rest comes off its Singapore-dollar revenue); a tariff raises it by the share passed on (default 80%). Units then change by the product's price elasticity (reagents −0.3, consumables −0.6, instruments −1.2) times how price-sensitive that customer type is (public hospitals 0.5, clinic groups 1.2), plus any demand shift for reasons other than price. Twelve months of orders cannot separate a market effect from normal ups and downs, so these sensitivities are stated assumptions, shown and editable on the page, not estimates.

**Purchase likelihood** (`analysis/propensity.py`). Before building scenarios on a model, we tested whether one could predict which customers will order each product line next quarter. A logistic regression on recent orders, trend, months since the last order and what similar customers buy was trained on January to March 2026 snapshots and tested on July to September 2026, a quarter it never saw. It scores an AUC of 0.976, but the simple rule "ordered this product in the last 3 months" scores 0.973: in this data customers either keep buying a product line or stop, and the going-quiet alerts already catch those who stop. So the scenarios start from the forecast and each customer's recent orders. With 24 to 36 months of SAP B1 history joined to Monetary Authority of Singapore exchange rates and customs tariff schedules, the sensitivities can be estimated by regression and checked with the same backtest as the forecast.

**Inbox sorting** (`analysis/triage.py`). TF-IDF over words and word pairs with a logistic regression, trained on 2,703 messages and tested on 902 it never saw. Greetings and sign-offs are removed so the model learns intent, not politeness. Mistakes cluster on mixed messages (an order with a question attached); below 80% confidence the email goes to a person.

## How it would run at Lives Group

| In this prototype | In production | Built by |
|---|---|---|
| Request form | Power Apps (Microsoft Forms for the simplest types) | MDM team and one power user |
| Requests, settings, audit log | SharePoint lists (Dataverse later if needed) | MDM team |
| Routing, reminders, escalation | Power Automate with Teams and Outlook approvals | MDM team and one power user |
| Duplicate check | The same matching logic as a small Azure Function called by the flow | Outside help, short engagement |
| SAP B1 import file | Data Transfer Workbench import; Service Layer write-back in phase 3 | MDM team; SAP partner for phase 3 |
| Regional view and forecast | Power BI on SAP B1 purchase-order data | Analyst, with help for the data connection |
| Market scenarios | Power BI what-if parameters on the forecast, fed by MAS exchange rates and tariff schedules | Analyst, with finance |
| Inbox sorting | AI step in Power Automate on the shared mailbox | Phase 3 pilot |

**Rollout.** Phase 1 (about 8 weeks): customer and item requests, parallel approvals, tracker, audit log and import file, piloted with SPD. Phase 2: all request types and business units, the duplicate-check service, the Power BI regional view, merging existing duplicates. Phase 3: SAP B1 write-back, inbox sorting, automated monthly forecast refresh.

**How to get requestors and approvers to get off email** Approval cards arrive in Teams and Outlook, so approvers learn nothing new, the form is faster than an email because it copies settings from a similar record, the shared mailbox auto-replies with the form link, once a business unit is live, email requests are no longer processed (for SPD from 4 January 2027, the end of the pilot, the date is a setting), each business unit has a champion, and leadership sees a weekly view of form usage, turnaround and overdue approvals.

## Assumptions

Every figure on the Business case page can be changed in the app. The defaults:

- **Minutes per request**, today → with the hub: MDM team 50 → 13, requester 30 → 5, each approver 10 → 4.
- **Staff cost:** SGD 55 an hour, fully loaded.
- **Duplicates:** 8% of new customer setups today are duplicates; the form catches 90%; each one costs 6 hours to untangle later.
- **Forecast preparation:** 16 hours a month today, 2 with the hub.
- **Inbox sorting:** 1.5 minutes saved per message sorted automatically.
- **Build:** 156 internal hours plus 10 days of outside help at SGD 1,200 a day.
- **Licences:** phase 1 uses standard connectors included in Microsoft 365. The phase 2 duplicate-check service needs a premium connector; that cost is not included and needs checking with Lives Group.
- **Turnaround with the hub:** approvers reply in 1.4 days on average; 5% of requests still bounce back and 8% need a question; reminders after 2 working days, escalation one working day later.
- **Market scenarios:** 50% of an exchange-rate move and 80% of a tariff passed into customer prices; price elasticity −0.3 for reagents, −0.6 for consumables, −1.2 for instruments; sensitivity 0.5 for public hospitals, 0.8 for research institutes, 1.0 for private hospitals and independent labs, 1.2 for clinic groups. All are stated, not estimated, and editable on the page.
- **Data:** 12 months of synthetic history (October 2025 to September 2026); 116 customer records, of which 10 are planted duplicates.

## How to run it

The app is plain HTML, CSS and JavaScript with no build step. `server.py` is optional and uses only the Python standard library.

```bash
# with the account server (logins checked in Python), then open http://localhost:8000
python3 server.py

# or any static server, as on GitHub Pages (logins checked in the browser), then open http://localhost:8000
python3 -m http.server 8000
```

Opening `index.html` directly from disk also works. `python3 scripts/build_single_file.py --document` writes a single self-contained HTML file to `dist/` for offline demos, login card included.

Rebuild the data and every number in the app:

```bash
python3 -m pip install -r requirements.txt
python3 analysis/generate_data.py   # synthetic data in data/ (fixed seed, identical every run)
python3 analysis/build_data.py      # analysis -> assets/data.js and analysis/output/RESULTS.md
```

Tests:

```bash
node --test tests/engine.test.cjs                        # workflow engine and Python/JavaScript parity (Node 20+)
python3 -m unittest discover -s tests -p "test_*.py"     # analysis, the account server and the demo accounts
python3 -m pip install playwright && python3 -m playwright install chromium
python3 tests/e2e.py                                     # every page and the demo path in a real browser
```

The results in this repository were produced with Python, pandas, Numpy and scikit-learn.

## Repository layout

```
index.html                 the app shell
login.html                 sign-in page, with the demo accounts
server.py                  local account server: login, registration, sessions (standard library only)
test_users.json            test accounts, passwords stored as salted PBKDF2 hashes
assets/
  app.js                   workflow pages: request form, approvals, tracker, MDM desk, settings
  insights.js              regional view, inbox sorting, business case
  market.js                market scenarios page
  auth.js                  checks who is signed in (server cookie or browser session), then loads the app
  login.js                 sign-in and registration; checks passwords in the browser when there is no server
  session.js               the browser sign-in session
  demo-accounts.js         the demo account per person shown on the login page
  accounts.js              browser copy of test_users.json (hashes only), written by server.py
  engine.js                rules, routing, SLAs, duplicate matching, classifier, import file (also runs in Node)
  charts.js                small SVG chart helpers, no libraries
  data.js                  generated by analysis/build_data.py
  app.css
analysis/
  generate_data.py         synthetic SAP B1 master data, 12 months of orders, mailbox, request history
  dedup.py                 duplicate matching and clustering
  forecasting.py           forecast methods and the rolling-origin backtest
  process_sim.py           turnaround model
  triage.py                inbox classifier
  propensity.py            purchase-likelihood model and its out-of-time test
  build_data.py            runs everything and writes assets/data.js
  output/RESULTS.md        digest of every result
data/                      the synthetic data as CSV, plus planted_patterns.json (ground truth)
scripts/
  build_single_file.py     one self-contained HTML file for offline use
tests/                     engine and parity tests (Node), analysis and account tests (Python), browser test (Playwright)
docs/                      two-page summary, demo video voiceover, screenshots
docs/diagrams/             to-be process flow and ER diagram
```

## Notes

- **Data.** Everything is synthetic, generated by `analysis/generate_data.py`. Patterns were planted on purpose and `data/planted_patterns.json` records each one, so the methods can be checked against the truth.
- **Security.** The prototype masks bank details and credit limits by role and logs every view and change, production would rely on Microsoft 365 permissions and an IT security review.
