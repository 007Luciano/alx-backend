// 100-seat.js

const express = require('express');
const redis = require('redis');
const { promisify } = require('util');
const kue = require('kue');

// Create a Redis client
const client = redis.createClient();
const getAsync = promisify(client.get).bind(client);

// Initialize seat availability and reservation status
const initialSeats = 50;
let reservationEnabled = true;

client.set('available_seats', initialSeats);

// Create a Kue queue
const queue = kue.createQueue();

// Reserve seats function
const reserveSeat = (number) => {
    client.set('available_seats', number);
};

// Get current available seats function
const getCurrentAvailableSeats = async () => {
    const seats = await getAsync('available_seats');
    return parseInt(seats, 10);
};

// Create an Express server
const app = express();
const port = 1245;

// Route to get the number of available seats
app.get('/available_seats', async (req, res) => {
    const availableSeats = await getCurrentAvailableSeats();
    res.json({ numberOfAvailableSeats: availableSeats });
});

// Route to reserve a seat
app.get('/reserve_seat', async (req, res) => {
    if (!reservationEnabled) {
        return res.json({ status: 'Reservations are blocked' });
    }

    const job = queue.create('reserve_seat').save((err) => {
        if (!err) {
            res.json({ status: 'Reservation in process' });
        } else {
            res.json({ status: 'Reservation failed' });
        }
    });
});

// Route to process the queue
app.get('/process', (req, res) => {
    res.json({ status: 'Queue processing' });

    queue.process('reserve_seat', async (job, done) => {
        const currentSeats = await getCurrentAvailableSeats();
        if (currentSeats <= 0) {
            reservationEnabled = false;
            return done(new Error('Not enough seats available'));
        }

        const newSeats = currentSeats - 1;
        reserveSeat(newSeats);

        if (newSeats === 0) {
            reservationEnabled = false;
        }

        done();
    });
});

// Kue job completed or failed event handlers
queue.on('job complete', (id) => {
    kue.Job.get(id, (err, job) => {
        if (!err) {
            console.log(`Seat reservation job ${job.id} completed`);
            job.remove((err) => {
                if (err) {
                    console.log(`Failed to remove completed job ${job.id}`);
                }
            });
        }
    });
});

queue.on('job failed', (id, errorMessage) => {
    kue.Job.get(id, (err, job) => {
        if (!err) {
            console.log(`Seat reservation job ${job.id} failed: ${errorMessage}`);
            job.remove((err) => {
                if (err) {
                    console.log(`Failed to remove failed job ${job.id}`);
                }
            });
        }
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
