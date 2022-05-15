const express = require('express')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { regexpToText } = require('nodemon/lib/utils');
const res = require('express/lib/response');
const app = express();
require('dotenv').config()
const port = process.env.PORT || 4000

app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ttwqk.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized Access' });
    }
    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        if (decoded) {
            req.decoded = decoded;
            next();
        }
    });
}

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("booking");
        const usersCollection = client.db("doctors_portal").collection("users");

        //admin check

        app.get('/admin/:email', verifyToken,async (req, res) => {
            const email = req.decoded.email;
            const user = await usersCollection.findOne({ email });
            const adminRole = user.role === 'admin'
            res.send(adminRole);
        })
        //users api

        app.get('/users', verifyToken, async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        })

        app.put('/user/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const requester = await usersCollection.findOne({ email: req.decoded.email });
            if (requester.role === 'admin') {
                const updateDoc = {
                    $set: { role: 'admin' },
                };
                const result = await usersCollection.updateOne(query, updateDoc);
                return res.send(result)
            } else {
                return res.status(403).send({ message: 'Forbidden Access' });
            }

        })
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const options = { upsert: true };
            const query = { email };
            const updateDoc = {
                $set: user,
            };
            const result = await usersCollection.updateOne(query, updateDoc, options);
            const token = jwt.sign({ email }, process.env.TOKEN_SECRET, { expiresIn: '1d' })
            res.send({ result, token })
        })


        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        })


        // available service api

        app.get('/available', async (req, res) => {
            const date = req.query.date;


            const services = await serviceCollection.find().toArray();

            const bookings = await bookingCollection.find({ treatmentDate: date }).toArray();

            services.forEach(service => {
                const bookedServices = bookings.filter(booking => booking.treatmentName === service.name);
                const booked = bookedServices.map(bs => bs.slot);
                const available = service.slots.filter(slot => !booked.includes(slot))
                service.available = available;
            })

            res.send(services);
        })


        //get booking api

        app.get('/booking', verifyToken, async (req, res) => {
            const decodedEmail = req.decoded.email;
            const email = req.query.email;
            if (email === decodedEmail) {
                const query = { patient: email };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings)
            } else {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
        })

        //booking api

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatmentName: booking.treatmentName, treatmentDate: booking.treatmentDate, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, result: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send({ success: true, result });

        })
    }
    catch (error) {
        console.log(error);
    }

}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})