# Visual Affect — LED Planning Tool

A full-featured LED wall planning, inventory management, and proposals tool built for Visual Affect.

## Stack
- **Frontend:** Vanilla HTML/CSS/JS (modular ES modules)
- **Backend:** Supabase (PostgreSQL + Auth + Storage + Realtime)
- **Hosting:** Netlify (auto-deploy from GitHub)

## Setup

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com)
2. Run `schema.sql` in the Supabase SQL Editor
3. Create your admin user in Authentication → Users
4. Note your **Project URL** and **anon public key**

### 2. Local Development
1. Clone this repo
2. Open `index.html` in the browser (use a local server — VS Code Live Server works great)
3. Replace the placeholder values in `index.html`:
```js
window.ENV = {
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key-here',
};
```

### 3. Netlify Deployment
1. Connect this GitHub repo to Netlify
2. Go to **Site Settings → Environment Variables** and add:
   - `SUPABASE_URL` → your Supabase project URL
   - `SUPABASE_ANON_KEY` → your Supabase anon key
3. Every push to `main` auto-deploys

## File Structure
```
visual-affect-led/
├── index.html          ← App shell + auth
├── client.html         ← Public proposal approval page
├── netlify.toml        ← Netlify config
├── css/
│   └── styles.css      ← All styles
├── js/
│   ├── supabase.js     ← DB client + offline queue
│   ├── auth.js         ← Login, register, roles
│   ├── store.js        ← Data operations
│   ├── ui.js           ← Shared UI components
│   ├── engine.js       ← LED calculation engine
│   ├── clients.js      ← Client management
│   ├── projects.js     ← Project wizard + view
│   ├── logistics.js    ← Schedule, labor, files
│   ├── inventory.js    ← Inventory + checkout
│   ├── proposals.js    ← Proposals + invoices
│   ├── tasks.js        ← Task management
│   ├── admin.js        ← Admin panel
│   └── pdf.js          ← PDF exports
└── assets/
    ├── logo-dark.png   ← Logo for light backgrounds
    └── logo-white.png  ← Logo for dark backgrounds
```

## User Roles
| Role | Access |
|---|---|
| **Admin** | Full access — users, settings, all projects |
| **Manager** | Projects, inventory, proposals, logistics |
| **Technician** | Assigned projects, tasks, view inventory |
