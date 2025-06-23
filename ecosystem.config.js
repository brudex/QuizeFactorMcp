module.exports =  {
    apps : [{
      name: "QuizMcp",
      script: "./src/server.js",
      env: {
        NODE_ENV: "production",
        PORT: 3046,
      }
    }]
};
