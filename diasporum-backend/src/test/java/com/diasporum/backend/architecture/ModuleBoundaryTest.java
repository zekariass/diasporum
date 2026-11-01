package com.diasporum.backend.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Enforces the v10.11 modular-monolith boundaries:
 * a module's {@code internal.*} packages may only be used by that module, and
 * modules may not form cyclic dependencies. Analysis covers main classes only
 * ({@code DO_NOT_INCLUDE_TESTS}).
 */
class ModuleBoundaryTest {

    private static final String ROOT = "com.diasporum.backend";

    private static final List<String> MODULES = List.of(
            "identity", "social", "community", "taxonomy", "media", "feed",
            "communitychat", "messaging", "voice", "businessaccounts",
            "businessdirectory", "events", "jobs", "propertylistings",
            "vehiclelistings", "sparebag", "matchmaking", "servicemarketplace",
            "billing", "notifications", "moderation", "administration",
            "appconfiguration", "security", "platform");

    private static com.tngtech.archunit.core.domain.JavaClasses mainClasses() {
        return new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages(ROOT);
    }

    static List<String> modules() {
        return MODULES;
    }

    @ParameterizedTest(name = "outsiders must not access {0}.internal")
    @MethodSource("modules")
    void moduleInternalsAreEncapsulated(String module) {
        ArchRule rule = noClasses()
                .that().resideOutsideOfPackage(ROOT + "." + module + "..")
                .should().dependOnClassesThat()
                .resideInAPackage(ROOT + "." + module + ".internal..")
                .as("module '" + module + "' internals are private to the module");
        rule.check(mainClasses());
    }

    @Test
    void noCyclicModuleDependencies() {
        ArchRule rule = slices().matching(ROOT + ".(*)..")
                .should().beFreeOfCycles()
                .as("feature modules must not form dependency cycles");
        rule.check(mainClasses());
    }
}
