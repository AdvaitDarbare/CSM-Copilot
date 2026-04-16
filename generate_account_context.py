from csm_engine import SOURCE_DIR, materialize_source_data


def main():
    output_dir = materialize_source_data()
    print(f"Generated structured synthetic source datasets in {output_dir}")


if __name__ == "__main__":
    main()
