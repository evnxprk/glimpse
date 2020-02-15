const { Person } = require('./classes/Person');
const { User } = require('./classes/User');
const { Role } = require('./classes/Role');
const { DateTimeResolver } = require('graphql-scalars');


const resolvers = {
    DateTime: DateTimeResolver,
    Query: {
        users: async (obj, args) => {
            return User.getPaginatedUsers(args.pageSize, args.prevUserIndex);
        },
        members: async (obj, args) => {
            return Person.getPaginatedMembers(args.pageSize, args.prevPersonIndex);
        },
        people: async (obj, args) => {
            return Person.getPaginatedPeople(args.pageSize, args.prevPersonIndex);
        },

        userCount: async () => {
            return User.getUserCount();
        },
        peopleCount: async () => {
            return Person.getPeopleCount();
        },
        memberCount: async () => {
            return Person.getMemberCount();
        }
    },
    User: {
        identity: async (obj) => {
            return obj.getIdentity();
        }
    },
    Person: {
        roles: async(obj) => {
            return Role.getRolesForPerson(obj);
        }
    },
    Role: {
        appearsAfter: async(obj) => {
            return obj.getPreviousRole();
        }
    },

    Mutation: {
        createPerson: async (obj, args) => {
            return Person.createPerson(args.firstName, args.lastName, args.preferredName, args.classYear);
        },
        updatePerson: async (obj, args) => {
            const person = await Person.getPersonFromId(args.id);
            if(person == null)
                throw new Error('Person with the provided \'id\' does not exist!');
            if(args.firstName !== undefined) {
                person.firstName = args.firstName;
            }
            if(args.lastName !== undefined) {
                person.lastName = args.lastName;
            }
            if(args.preferredName !== undefined) {
                person.preferredName = args.preferredName;
            }
            if(args.classYear !== undefined) {
                person.classYear = args.classYear;
            }
            if(await person.save())
                return person;
            return null;
        },
        deletePerson: async (obj, args) => {
            const person = await Person.getPersonFromId(args.id);
            if(person == null)
                throw new Error('Person with the provided \'id\' does not exist!');
            await person.delete();
            return true;
        },
        createRole: async (obj, args) => {
            return Role.createRole(await Person.getPersonFromId(args.owner), args.name, args.startDate,
                args.endDate, await Role.getRoleFromId(args.appearsAfter));
        },
        updateRole: async (obj, args) => {
            const role = await Role.getRoleFromId(args.id);
            if(role == null)
                throw new Error('Role with the provided \'id\' does not exist!');
            if(args.name !== undefined) {
                role.name = args.name;
            }
            if(args.owner !== undefined) {
                await role.setOwner(args.owner);
            }
            if(args.startDate !== undefined) {
                role.startDate = args.startDate;
            }
            if(args.endDate !== undefined) {
                role.endDate = args.endDate;
            }
            if(args.appearsAfter !== undefined) {
                await role.setPreviousRole(args.appearsAfter);
            }
            if(await role.save())
                return role;
            return null;
        },
        deleteRole: async (obj, args) => {
            const role = Role.getRoleFromId(args.id);
            if(role == null)
                throw new Error('Role with the provided \'id\' does not exist!');
            await role.delete();
            return true;
        }
    }
};

module.exports = resolvers;
