
# Inkwire Vector CMS Backend

A modern, scalable backend API for the Inkwire Vector Content Management System, built to handle high-performance content delivery and management workflows.

## 🚀 Features

- **RESTful API Architecture** 
- **Vector-based Content Processing**
- **Authentication & Authorization**
- **Real-time Updates**
- **Database Agnostic**
- **Scalable Infrastructure**

## 📋 Prerequisites

Before setting up the Inkwire Vector CMS Backend, ensure you have the following installed:

- **Node.js** (v18.0.0 or higher)
- **npm** or **yarn** package manager
- **Git** for version control

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Harsh6637/inkwire-vector-cms-backend.git
cd inkwire-vector-cms-backend
```

### 2. Install Dependencies

```bash
# Using npm
npm install

# Using yarn
yarn install
```

### 3. Environment Configuration

Create a `.env` file in the root directory and configure the following variables:

```env
DATABASE_URL=<ENTER YOUR DATABASE CONNECTION URL>
JWT_SECRET=<ENTER YOUR JWT TOKEN>
OPENAI_API_KEY=<ENTER YOUR OPRNAI API KEY>
PORT=<ENTER PORT ON WHICH YOU WANT SERVER TO RUN, DEFAULT PORT IS 3001>

```

### Production Mode

```bash
# Build the application
npm run build

# Start production server
npm run start
```