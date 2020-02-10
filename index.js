require('dotenv').config();
const { initSchema } = require('./postgres-init');
const gqlSchema = require('./schema');
const gqlResolvers = require('./resolvers');
const { ApolloServer } = require('apollo-server');

initSchema().then(() => {

    const server = new ApolloServer({
        typeDefs: gqlSchema,
        resolvers: gqlResolvers
    });

// The `listen` method launches a web server.
    server.listen().then(({ url }) => {
        console.log(`🚀  Server ready at ${url}`);
    });

}).catch((err) => console.error(err.stack));
