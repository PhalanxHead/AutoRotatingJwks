import { awscdk } from 'projen';
import { TrailingComma } from 'projen/lib/javascript';

const project = new awscdk.AwsCdkTypeScriptApp({
  authorName: 'PhalanxHead',
  cdkVersion: '2.39.0',
  defaultReleaseBranch: 'main',
  name: 'AutoRotatingJwks',
  description: 'A Construct that Serves, AutoRotates and AutoInvalidates Signing Keys',
  projenrcTs: true,
  appEntrypoint: 'app/infra/main.ts',
  lambdaAutoDiscover: false,

  prettier: true,
  prettierOptions: {
    settings: {
      printWidth: 140,
      tabWidth: 4,
      singleQuote: true,
      semi: true,
      trailingComma: TrailingComma.ES5,
    }
  },

  depsUpgrade: false,

  eslint: true,

  deps: ['@aws-sdk/client-kms', '@aws-sdk/client-s3', '@aws-sdk/client-cloudfront', 'aws-lambda', 'jose'],
  devDeps: ['prettier-eslint', '@types/aws-lambda']
});

project.synth();