# Cortex Automation - Comprehensive Audit Flaws

This document contains a consolidated list of all flaws, bugs, performance bottlenecks, and type safety issues discovered during the exhaustive line-by-line audit of the project.

## 1. `src/server.ts`
* **Line 12:** `async function parseJsonBody(req: http.IncomingMessage): Promise<any> {`
  * **Issue (Type Safety):** Returning `any` propagates untyped data across the codebase.
  * **Fix:** `async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {`
* **Line 118:** `fs.writeFileSync(settingsPath, JSON.stringify({ defaultAccount: type }) + '\n');`
  * **Issue (Performance):** Synchronous `fs.writeFileSync` inside an HTTP handler blocks the Node event loop, reducing server concurrency.
  * **Fix:** `await fs.promises.writeFile(settingsPath, JSON.stringify({ defaultAccount: type }) + '\n');`
* **Line 144:** `} catch (err: any) {`
  * **Issue (Type Safety):** Use of `any` in catch block.
  * **Fix:** `} catch (err: unknown) {`
* **Line 149:** `server.on('error', (e: any) => {`
  * **Issue (Type Safety):** Use of `any` for Node error object.
  * **Fix:** `server.on('error', (e: NodeJS.ErrnoException) => {`

## 2. `frontend/src/App.tsx`
* **Line 32:** `} catch (e) {}`
  * **Issue (Bug):** Empty catch block silently swallows errors during API calls, making debugging difficult.
  * **Fix:** `} catch (e) { console.error('Failed to fetch settings/channel', e); }`
* **Line 35:** `const updateBalanceState = (balanceData: any) => {`
  * **Issue (Type Safety):** Use of `any` bypasses strict type checking.
  * **Fix:** `const updateBalanceState = (balanceData: { formattedBalance?: string; accountType?: string; timestamp?: string | number | Date }) => {`
* **Line 105:** `<Header systemMode={accountType as any} />`
  * **Issue (Type Safety):** Unsafe type casting to `any` for component props.
  * **Fix:** `<Header systemMode={accountType as 'Live' | 'Demo' | 'Unknown'} />`

## 3. `frontend/src/services/api.ts`
* **Line 11:** `history?: any[];`
  * **Issue (Type Safety):** Using `any[]` disables type checking on array elements.
  * **Fix:** `history?: unknown[];`
* **Line 25:** `meta?: any;`
  * **Issue (Type Safety):** Using `any` allows unsafe assignment.
  * **Fix:** `meta?: unknown;`

## 4. `test-event.ts`
* **Line 11:** `function extractPeerChannelId(target: any): bigint | null {`
  * **Issue (Type Safety):** Use of `any` bypasses type checking.
  * **Fix:** `function extractPeerChannelId(target: unknown): bigint | null {`
* **Line 44:** `client.addEventHandler((event: any) => {`
  * **Issue (Type Safety):** `any` type used instead of proper GramJS type.
  * **Fix:** `client.addEventHandler((event: NewMessageEvent) => {`
* **Line 51:** `fs.appendFileSync('test_log.txt', logStr);`
  * **Issue (Performance):** Synchronous file writing blocks the Node.js event loop.
  * **Fix:** `fs.promises.appendFile('test_log.txt', logStr).catch(console.error);`

## 5. `test-history.ts`
* **Line 10:** `function extractPeerChannelId(target: any): bigint | null {`
  * **Issue (Type Safety):** Use of `any` bypasses strict type checking.
  * **Fix:** `function extractPeerChannelId(target: unknown): bigint | null {`
* **Line 61:** `} catch (err) {`
  * **Issue (Type Safety):** Implicit `any` for catch block variable without typing.
  * **Fix:** `} catch (err: unknown) {`

## 6. `src/balance.ts`
* **Line 108:** `await page.waitForLoadState('domcontentloaded').catch(() => {});`
  * **Issue (Bug / Concurrency):** Empty catch block silently swallows critical navigation errors; if load state fails, further evaluation runs on an invalid page causing cascading failures.
  * **Fix:** `await page.waitForLoadState('domcontentloaded').catch(e => logger.warn('waitForLoadState error', e));`

## 7. `src/bot.ts`
* **Line 46:** `function extractPeerChannelId(target: any): bigint | null {`
  * **Issue (Type Safety):** `target: any` bypasses strict checks.
  * **Fix:** `function extractPeerChannelId(target: unknown): bigint | null {`
* **Line 396:** `catch (err: any) {`
  * **Issue (Type Safety):** Unnecessary use of `any` in catch clause.
  * **Fix:** `catch (err: unknown) {`
* **Line 448:** `process.on('uncaughtException', (err) => { logger.error('Uncaught Exception thrown', err); });`
  * **Issue (Bug / Memory Leak):** The application continues running after an uncaught exception, which can leave it in an unpredictable, unstable state and cause memory leaks or zombie processes.
  * **Fix:** `process.on('uncaughtException', (err) => { logger.error('Uncaught Exception thrown', err); process.exit(1); });`

## 8. `src/check-balance.ts`
* **Line 65:** `} catch (error: any) {`
  * **Issue (Type Safety):** Use of `any` in catch block.
  * **Fix:** `} catch (error: unknown) {`

## 9. `src/executor.ts`
* **Line 400:** `} catch (err: any) {`
  * **Issue (Type Safety):** Catch clause unnecessarily uses `any`.
  * **Fix:** `} catch (err: unknown) {`
* **Line 1046:** `const debug = (result as any).debug || '';`
  * **Issue (Type Safety):** Unnecessary use of `any` for object property access.
  * **Fix:** `const debug = (result as { debug?: string }).debug || '';`

## 10. `src/list-channels.ts`
* **Line 42:** `const entity = d.entity as any;`
  * **Issue (Type Safety):** Unsafe `any` cast on external entity.
  * **Fix:** `const entity = d.entity as Record<string, unknown>;`
* **Line 75:** `} catch (err) {`
  * **Issue (Type Safety):** Implicit `any` for catch block variable without typing.
  * **Fix:** `} catch (err: unknown) {`

## 11. `src/list-profiles.ts`
* **Line 41:** `const data = info as any;`
  * **Issue (Type Safety):** Unsafe `any` cast when reading JSON structure.
  * **Fix:** `const data = info as { name?: string; user_name?: string; hosted_domain?: string };`

## 12. `src/logger.ts`
* **Line 30:** `let formattedMeta: any = meta;`
  * **Issue (Type Safety):** `any` allows unsafe assignment.
  * **Fix:** `let formattedMeta: unknown = meta;`

## 13. `src/queue.ts`
* **Line 10:** `private tail: Promise<any> = Promise.resolve();`
  * **Issue (Type Safety):** Promise is explicitly typed as `any`, bypassing strict type checks.
  * **Fix:** `private tail: Promise<unknown> = Promise.resolve();`

## 14. `src/test-suite.ts`
* **Line 419:** `const clickedUp = await page.evaluate(() => (window as any).lastClicked);`
  * **Issue (Type Safety):** Unsafe `any` cast on window object.
  * **Fix:** `const clickedUp = await page.evaluate(() => (window as unknown as { lastClicked: string }).lastClicked);`
* **Line 425:** `const clickedDown = await page.evaluate(() => (window as any).lastClicked);`
  * **Issue (Type Safety):** Unsafe `any` cast on window object.
  * **Fix:** `const clickedDown = await page.evaluate(() => (window as unknown as { lastClicked: string }).lastClicked);`
* **Line 566:** `const clickedBtn = await page.evaluate(() => (window as any).clickedButton);`
  * **Issue (Type Safety):** Unsafe `any` cast on window object.
  * **Fix:** `const clickedBtn = await page.evaluate(() => (window as unknown as { clickedButton: string }).clickedButton);`
* **Line 679:** `const clickedAsset = await page.evaluate(() => (window as any).clickedAsset);`
  * **Issue (Type Safety):** Unsafe `any` cast on window object.
  * **Fix:** `const clickedAsset = await page.evaluate(() => (window as unknown as { clickedAsset: string }).clickedAsset);`
