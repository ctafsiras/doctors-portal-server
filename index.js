const express = require('express')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const res = require('express/lib/response');
const app = express();
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_PVT_KEY);
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
        const doctorsCollection = client.db("doctors_portal").collection("doctors");
        const paymentCollection = client.db("doctors_portal").collection("payments");


        const verifyAdmin = async (req, res, next) => {
            const email = req.params.email;
            const query = { email };
            const requester = await usersCollection.findOne({ email: req.decoded.email });
            if (requester.role === 'admin') {
                next();
            } else {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
        }


        // update api payment
        app.patch('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.id
                }
            }
            const update = await bookingCollection.updateOne(filter, updateDoc);
            const result = await paymentCollection.insertOne(payment);
            res.send(update);
        })


        // add doctors api
        app.post('/doctors', verifyToken, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        })

        //get doctor api

        app.get('/doctors', verifyToken, verifyAdmin, async (req, res) => {
            const doctors = await doctorsCollection.find().toArray();
            res.send(doctors);
        })

        //delete doctor api
        app.delete('/doctor/:email', verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })

        //admin check

        app.get('/admin/:email', verifyToken, async (req, res) => {
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

        app.put('/user/admin/:email', verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await usersCollection.updateOne(query, updateDoc);
            return res.send(result)
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

        //only service name api
        app.get('/serviceNames', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
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

        //get booking by id api

        app.get('/booking/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await bookingCollection.findOne(filter);
            res.send(result);
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


        //paymennt api

        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                automatic_payment_methods: {
                    enabled: true,
                },
            });
            res.send({ clientSecret: paymentIntent.client_secret })
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