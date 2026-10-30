# College Wi-Fi exam setup

Supabase Auth rate limits are applied to public IP addresses. If a lab or campus Wi-Fi sends many students through one public IP, a student can receive HTTP 429 even with a correct password. The app now reduces avoidable Auth calls and exam polling, but client code cannot change the project-wide rate limit.

Before a large exam:

1. In the Supabase project, open **Authentication → Rate Limits**. Set the **Token endpoint requests** limit for the expected number of students signing in from one public IP during the exam entry period, allowing extra capacity for retries and token refreshes. Review the **Sign-ups and sign-ins** limit too if students will create accounts or request recovery during that period. Return limits to normal after the exam if appropriate.
2. Ask students to sign in over several minutes before the exam starts. Supabase Auth allows only a limited burst from one IP even when the sustained limit is raised.
3. Ask the college network administrator to verify that the deployed app and `https://<project-ref>.supabase.co` are reachable from the lab. Captive Wi-Fi sign-in pages and blocked API domains cause connection errors that the app cannot resolve locally.
4. Test a group of real lab PCs on the same Wi-Fi ahead of the exam. Verify sign-in, the 250 kbps preflight, saving an answer, and submission. Check **Supabase Auth logs** for HTTP 429 and the browser network panel for failed requests.
5. If the Wi-Fi is unreliable, students should retain the same browser and its site data. Exam drafts are stored locally until they can sync; a different computer will not have that draft.

Supabase reference: https://supabase.com/docs/guides/auth/rate-limits
