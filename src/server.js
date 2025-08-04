const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());


app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.post('/tally', (req, res) => {
  console.log(req.body);
  res.send('Hello World!');
});

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});