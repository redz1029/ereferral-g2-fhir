// Domain Entity - Practitioner
class Practitioner {
    constructor({ id, name, qualification, telecom }) {
        this.id = id;
        this.name = name;
        this.qualification = qualification;
        this.telecom = telecom;
    }

    static fromFhirJson(json) {
        const name = (json.name && json.name[0]) || {};
        const qualification = (json.qualification && json.qualification[0]) || {};
        const telecom = (json.telecom && json.telecom[0]) || {};

        return new Practitioner({
            id: json.id || '',
            name: {
                family: name.family || '',
                given: (name.given && name.given[0]) || ''
            },
            qualification: {
                text: (qualification.code && qualification.code.text) || ''
            },
            telecom: {
                system: telecom.system || 'phone',
                value: telecom.value || ''
            }
        });
    }

    toFhirJson() {
        const fhir = { resourceType: 'Practitioner' };

        if (this.name && (this.name.family || this.name.given)) {
            fhir.name = [{
                family: this.name.family || undefined,
                given: this.name.given ? [this.name.given] : undefined
            }];
        }

        if (this.qualification && this.qualification.text) {
            fhir.qualification = [{
                code: { text: this.qualification.text }
            }];
        }

        if (this.telecom && this.telecom.value) {
            fhir.telecom = [{
                system: this.telecom.system || 'phone',
                value: this.telecom.value
            }];
        }

        return fhir;
    }
}
