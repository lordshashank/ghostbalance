module.exports = {
  apps: [{
    name: "ghostbalance-backend",
    script: "dist/index.js",
    cwd: __dirname,
    node_args: "--env-file=.env",
    exec_mode: "fork",
    autorestart: true,
    env: {
      NODE_ENV: "production",
    },
  }],
};
